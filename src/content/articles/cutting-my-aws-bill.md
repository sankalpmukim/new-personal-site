---
title: "I Cut My AWS Bill to the Bone (and What It Cost Me)"
description: "A three-act story about taking a real Next.js + Postgres app from Vercel + RDS to a single, self-hosted, IPv6-only EC2 instance — pulling every cost lever, breaking several things along the way, and learning the unglamorous mechanics of how AWS actually charges you."
date: 2026-06-28
---

> A three-act story about taking a real Next.js + Postgres app from **Vercel + RDS** to a single, self-hosted, IPv6-only EC2 instance — pulling every cost lever, breaking several things along the way, and learning the unglamorous mechanics of how AWS _actually_ charges you.

**The headline:** a ~$44/month workload now runs for effectively $0 in incremental spend, on infrastructure I already paid for. **The real story:** the $3.60 I tried to save at the end cost me more pain than the $40 I saved at the start. The lessons are in the pain.

---

## The setup

A small donation-tracker app for an NGO — Next.js 15, Drizzle ORM, `postgres.js`, Tailwind. The classic T3 stack. **Two users. One donation row.** Embarrassingly tiny.

It was hosted the way everyone hosts things in 2026:

```
Vercel  ──►  Amazon RDS (Postgres 17, db.t4g.micro)
              publicly accessible, Single-AZ
```

Plus an EC2 instance I already ran for other personal sites, fronted by nginx. The app and its database were _already_ sitting inside the same AWS VPC, on the same subnet, a few milliseconds apart — and I was paying two companies to keep them separated.

---

## Act 1 — The bill that lied to me

### Credits are a deadline, not a discount

The AWS console told me my bill was **~$0.00/month**. I had credits. Life was good.

This is the first and most important trap, so let me say it loud:

> **The "Bills" page shows you _net_ cost (after credits). To optimize, you must look at _gross_. Credits expire. When they do, the gross number becomes your real number.**

The right tool is **Cost Explorer** via the CLI, not the console. Three commands that changed how I see my AWS spend:

```bash
# 1. Net total per month (the number that hides the truth)
aws ce get-cost-and-usage \
  --time-period Start=2026-03-01,End=2026-06-01 \
  --granularity MONTHLY --metrics "UnblendedCost"

# 2. Break down by RECORD_TYPE — separates usage from credits
aws ce get-cost-and-usage \
  --time-period Start=2026-03-01,End=2026-06-01 \
  --granularity MONTHLY --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=RECORD_TYPE

# 3. Break down by SERVICE, filtering OUT credits/refunds (the real gross)
aws ce get-cost-and-usage \
  --time-period Start=2026-05-01,End=2026-06-01 \
  --granularity MONTHLY --metrics "UnblendedCost" \
  --filter '{"Not":{"Dimensions":{"Key":"RECORD_TYPE","Values":["Credit","Refund"]}}}' \
  --group-by Type=DIMENSION,Key=SERVICE
```

Strip away the credits and the truth came out:

| Month | Gross usage | Credits | Net (what I _saw_) |
| ----- | ----------- | ------- | ------------------ |
| March | $23.85      | −$23.85 | ~$0                |
| April | $23.25      | −$23.25 | ~$0                |
| May   | **$43.90**  | −$43.90 | ~$0                |

The gross had nearly **doubled** in May, and the credits were about to run out. I had been optimizing against a fake number.

### Where the money was actually going

Breaking May down by service, filtering out credits:

| Service                                | Cost/mo | What it was                                   |
| -------------------------------------- | ------- | --------------------------------------------- |
| EC2 compute (`t3a.medium` at the time) | $28.07  | the instance itself                           |
| Amazon RDS                             | $8.55   | managed Postgres                              |
| EC2 other (EBS)                        | $1.83   | the volume                                    |
| **Amazon VPC**                         | $5.46   | **public IPv4 addresses — not a NAT gateway** |
| S3 / others                            | ~$0     | negligible                                    |

A few of those deserve a closer look, because they each contain a lesson.

#### The "VPC" line that wasn't a NAT gateway

Everyone's instinct when they see a mystery VPC charge is to blame the **NAT Gateway** (~$3.60/mo fixed + data). Mine was not. I had to break it down by `USAGE_TYPE`, not just `SERVICE`:

| Usage Type                     | Cost      |
| ------------------------------ | --------- |
| `APS3-PublicIPv4:InUseAddress` | **$5.45** |
| `APS3-PublicIPv4:IdleAddress`  | $0.0004   |

Two public IPv4 addresses. Since February 2024, AWS charges **$0.005/hour (~$3.60/mo) per public IPv4**. The table looked like this:

| Elastic IP                | Attached to                                    | Necessary? |
| ------------------------- | ---------------------------------------------- | ---------- |
| EC2 EIP (`198.51.100.10`) | The EC2 instance                               | Yes        |
| RDS EIP (`198.51.100.20`) | **RDS** managed ENI (`RequesterManaged: True`) | **No**     |

**The lesson:** setting RDS `PubliclyAccessible=True` silently allocates a _billable public IPv4_. The EC2 and RDS were in the _same subnet_ — the app could reach Postgres over the private network (`10.0.0.5`) with zero need for a public IP on the DB. That single checkbox was costing me $3.60/month.

#### The RDS line — the real target

Drilling into RDS by `USAGE_TYPE`:

| Component                     | Cost  |
| ----------------------------- | ----- |
| `db.t4g.micro` instance hours | $7.27 |
| gp3 storage (20 GB)           | $1.22 |
| Automated backups             | $0.06 |
| Cross-region data transfer    | ~$0   |

~$18/month of fully-loaded run rate, for a database holding **three rows**.

#### Reservation coverage

```bash
aws ce get-reservation-coverage \
  --time-period Start=2026-05-01,End=2026-06-01 --granularity MONTHLY
```

**0% coverage.** Everything was On-Demand. No RIs, no Savings Plans.

---

## Act 2 — Pulling the levers

With the gross bill understood, the plan almost wrote itself. Four levers, in order of payoff.

### Lever 1 — Right-size the EC2 (saves ~$17/mo)

The instance had been resized over time: `medium` → `large` → back. For a single low-traffic Next.js app sharing a box with nginx, a `t3a.small` (2 vCPU, 2 GB) is plenty. Stop, change type, start:

```bash
aws ec2 stop-instances --instance-ids i-<instance-id> --region <region>
aws ec2 wait instance-stopped --instance-ids i-<instance-id> --region <region>
aws ec2 modify-instance-attribute --instance-id i-<instance-id> \
  --instance-type '{"Value": "t3a.small"}' --region <region>
aws ec2 start-instances --instance-ids i-<instance-id> --region <region>
```

The catch: 2 GB RAM is tight when you also run nginx, a postgres container, and Node. We'll come back to that — it's where swap enters the story.

### Lever 2 — Kill RDS entirely (saves ~$18/mo)

This was the biggest win. The app and the DB were already co-located; paying AWS for managed Postgres compute, storage, backups, _and_ a public IP — for three rows — was pure waste.

**Migration path:**

1. `pg_dump` the RDS (schema + data, **5 KB total**)
2. Run a local `postgres:18-alpine` Docker container, bound to `127.0.0.1:5432` **only** (the DB is not reachable from the internet)
3. Restore data
4. Repoint the app's `DATABASE_URL` to `127.0.0.1`, `sslmode=disable`
5. Delete the RDS and all its attached resources

Sounds clean. It was _not_. This is where the migration turned into a live debugging session. Let me walk through what actually broke, because each failure is a reusable lesson.

---

#### Sidebar: The eight things that broke

##### 1. Disk filled to 100% — operations broke

The single hardest problem. A 19 GB EBS was at 94% when I started and hit **100% (146 MB free)** mid-migration. What makes this nasty is that **the tools that free space often need free space to run**:

- `docker builder prune` failed with `no space left on device` — the prune _itself_ writes metadata
- `docker pull postgres:18` failed mid-layer
- `fallocate` for swap failed
- `du`, the tool you'd use to find the problem, **timed out** from I/O thrashing

You get stuck: you can't free space because you have no space to free it _with_.

**The fix** is to use operations that free space _without_ needing temp writes:

```bash
rm -rf /some/dir                # frees inodes/blocks, writes nothing
truncate -s 0 /var/log/*.log    # zeroes a file in place
journalctl --vacuum-size=30M
apt-get clean
```

Once I had breathing room, the real culprits (found via `du -hx --max-depth=1 / | sort -rh` and `find / -xdev -size +100M`):

| Culprit                                         | Size   |
| ----------------------------------------------- | ------ |
| `~/.npm/_cacache` — a _cache_                   | 1.9 GB |
| A stale repo clone with broken build artifacts  | 4.7 GB |
| Orphaned `node_modules` from abandoned projects | ~2 GB  |

**Lesson:** on small EBS volumes, treat disk like memory. Audit periodically. **Cache directories are silent killers** — a _cache_ ate 1.9 GB. Also: clear the npm cache _after_ building, not before — it regrew to 873 MB the moment I ran `npm install` again.

##### 2. The 500 error that was actually stale code

After deploying, the app returned HTTP 500 with `errorMissingColumn` from Postgres. I assumed a connection issue. It wasn't.

The local clone was **behind `origin/main`**. A `git pull` revealed the schema had been completely refactored — a new `users` table, the `donations` table redesigned (`mobileNumber`→`phoneNumber`, `monthYearCode`→`startMonth`/`endMonth`, new serial `id`, `recurring` removed). The _old_ code was querying columns that no longer existed in the (already-migrated) RDS.

**Fix:** `git pull && npm run build`. One command.

**Lesson:** when an app talks to a shared, evolving DB, **always pull before building**. The 500 was a schema-drift artifact, not a connection problem.

##### 3. `drizzle-kit push` is broken on `varchar().primaryKey()`

Even after letting Drizzle _create the schema itself_, `drizzle-kit push` errored:

```
PostgresError: column "phone_number" is in a primary key
code: '42P16', routine: 'dropconstraint_internal'
```

Drizzle generates a spurious diff on the primary key constraint and tries to drop/recreate it in a way Postgres rejects. I proved this was a **tooling bug**, not a data problem: I dropped the tables, let Drizzle recreate them from scratch, ran `push` again — **same error on a schema Drizzle itself had just created**. The runtime schema was perfect (verified via `\d+`: PK present, FK with `ON DELETE CASCADE`, all indexes in place, writes worked).

**Workaround:** use `drizzle-kit migrate` (migration files) or hand-written SQL until the bug is fixed. The app itself is unaffected.

##### 4. `pg_dump` restore violated foreign keys

Restoring the dump failed on the first table:

```
ERROR: insert or update on table "...donation" violates foreign key constraint
DETAIL: Key (phone_number)=(<redacted>) is not present in table "...user".
```

**Cause:** `pg_dump` writes tables in **alphabetical order** — `donation` before `user`. But `donation.phone_number` has a FK to `user.phone_number`, so the parent rows must exist first.

**Fix:** restore users first, then donations. For larger schemas, either disable triggers during restore (`--disable-triggers`, needs superuser) or use `pg_restore --data-only` after loading schema in dependency order.

##### 5. postgres:18 changed its PGDATA default

The container crash-looped on first boot:

```
there appears to be PostgreSQL data in: /var/lib/postgresql/data (unused mount/volume)
```

The postgres **18** image defaults `PGDATA` to `/var/lib/postgresql/18/docker` (a versioned subdir), but I mounted the volume at the old default `/var/lib/postgresql/data`. The image detected "orphaned" data and refused to start.

**Fix:** `-e PGDATA=/var/lib/postgresql/data` explicitly. Always pin the data dir location when upgrading major versions of the postgres image.

##### 6. SSH + background processes = silent hangs

```bash
ssh myvm "nohup npx next start &"   # hangs, no output
```

`npx`/`next` spawn child processes that inherit and hold the SSH channel's stdout/stderr file descriptors. SSH waits for all FDs to close before returning — which never happens.

**Fix:** use a proper supervisor. We went straight to a **systemd unit** (`Type=simple`, `Restart=always`) — the correct production pattern anyway. For ad-hoc: `setsid cmd </dev/null >/log 2>&1 &`.

##### 7. `pkill -f` matched its own command

```bash
ssh myvm "pkill -f 'next start'"   # killed the session, no output
```

`pkill -f` matches against the **full command line** of running processes — including the remote bash shell executing the command containing the string `'next start'`. It killed itself.

**Fix:** kill by PID, not by pattern:

```bash
PID=$(ss -tlnp | grep ':3000' | grep -oE 'pid=[0-9]+' | cut -d= -f2)
kill "$PID"
```

##### 8. 2 GB RAM with no swap = OOM risk

After downsizing to `t3a.small` (2 GB) and stacking Next.js + postgres on a box already running nginx, opencode, and another container, I had ~1.1 GB available with **0 swap**. Postgres + Next.js could OOM-kill under load.

**Fix** — a 2 GB swapfile, free, living on the EBS I already paid for:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Lesson:** swap is **free insurance** on memory-constrained instances. It's slower than RAM but prevents OOM-kills. Monitor with `free -h`; only bump instance size if you actually swap-thrash.

---

### Lever 3 — Self-host instead of Vercel

The app moved onto the existing EC2 behind nginx. No new compute cost — it rides on capacity I was already paying for. Vercel bill eliminated, cold starts gone, one fewer vendor.

But the _real_ win of this move wasn't the Vercel line item — it was a **cascading architectural saving** that's easy to miss. While the app lived on Vercel, its servers were outside my VPC, which meant **the only way Vercel could reach the database was over the public internet.** That single fact is _why_ the RDS had `PubliclyAccessible=True`, which is _why_ AWS silently allocated it a billable public IPv4, which is _why_ the "Amazon VPC" line on my bill was $5.46/month.

The moment the app moved onto the EC2 — sitting in the **same subnet** as the database — that constraint vanished. The Postgres container binds to `127.0.0.1:5432` only: not on a public IP, not even on the VPC private range, just loopback. The app reaches it through the kernel's network stack, never touching the wire. **No exposed database, no public IPv4 on the DB, no `PubliclyAccessible` checkbox, no RDS-managed EIP.**

That's how one architectural decision (where the app runs) quietly eliminated the **$3.60/month RDS Elastic IP** from the "VPC" line — on top of removing the Vercel bill. Co-location isn't just cheaper compute; it removes the _reason_ for the network exposure that AWS charges you for.

### Lever 4 — Delete dead resources

| Removed                                               | Freed        |
| ----------------------------------------------------- | ------------ |
| Stale repo clone with broken build artifacts          | 4.7 GB       |
| Old project + systemd + nginx site + cert             | 1.3 GB + RAM |
| Another project's `node_modules` (deployed elsewhere) | 848 MB       |
| npm cache (`~/.npm`)                                  | 873 MB       |

Disk went from **100% → 63%**. Not a direct line item, but a full EBS is a ticking bomb — and resizing EBS _costs_ money.

### The net result of Act 2

- **~$18/month** of RDS spend eliminated
- **~$17/month** of EC2 compute trimmed
- Vercel removed
- The app now runs on infrastructure that was _already being paid for_

```
BEFORE                                   AFTER
─────                                    ─────
Vercel (Next.js)                         EC2 systemd service (Next.js :3000)
   │                                        │
   ▼                                        ▼
RDS Postgres ← public EIP + SG + subnet    Local Docker postgres (127.0.0.1:5432)
                                           nginx + Let's Encrypt SSL
```

---

## Act 3 — The $3.60 that almost broke me

After Act 2, the _only_ remaining AWS charge for this workload was a single **public IPv4 Elastic IP** on the EC2:

- Elastic IP allocation → `<public-ipv4>`
- Cost: **$0.005/hour = ~$3.60/month**

**IPv6 addresses on AWS are free.** The thesis: give the instance an IPv6 address, point DNS at it, release the IPv4 EIP, save $3.60/month ($43/year).

The savings are tiny. The point was the **learning**: what does it actually take to run a public server on IPv6-only in 2026? Answer: **more than you'd think, and one thing nobody warns you about.**

### The six AWS-side steps (each lines up)

Starting state: everything was IPv4-only. No IPv6 CIDR on the VPC, subnet, route table, instance, or security group.

```bash
# 1. Associate an IPv6 CIDR to the VPC (AWS assigns a /56)
aws ec2 associate-vpc-cidr-block \
  --vpc-id vpc-<vpc-id> \
  --amazon-provided-ipv6-cidr-block --region <region>
# → 2001:db8::/56

# 2. Carve a /64 for the subnet
aws ec2 associate-subnet-cidr-block \
  --subnet-id subnet-<subnet-id> \
  --ipv6-cidr-block 2001:db8::/64 --region <region>

# 3. Add the IPv6 default route
aws ec2 create-route \
  --route-table-id rtb-<route-table-id> \
  --destination-ipv6-cidr-block ::/0 \
  --gateway-id igw-<gateway-id> --region <region>

# 4. Assign an IPv6 address to the instance ENI
aws ec2 assign-ipv6-addresses \
  --network-interface-id eni-<eni-id> \
  --ipv6-address-count 1 --region <region>
# → 2001:db8::1234:5678:9abc:def0

# 5. Add IPv6 inbound rules to the security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-<security-group-id> --region <region> --ip-permissions \
    IpProtocol=tcp,FromPort=22,ToPort=22,Ipv6Ranges='[{CidrIpv6=::/0}]' \
    IpProtocol=tcp,FromPort=80,ToPort=80,Ipv6Ranges='[{CidrIpv6=::/0}]' \
    IpProtocol=tcp,FromPort=443,ToPort=443,Ipv6Ranges='[{CidrIpv6=::/0}]'
```

**Step 6 — OS config — was the surprise:** _nothing was needed_. The Ubuntu AMI picked up the IPv6 address automatically via Router Advertisements. nginx was already listening on `[::]:80` and `[::]:443`. sshd was already on `[::]:22`. Outbound IPv6 worked on the first try.

> **Lesson:** modern Ubuntu on AWS is IPv6-ready out of the box. The work is almost entirely on the AWS networking side, not the OS. And **security groups are protocol-family-specific** — an IPv4 `0.0.0.0/0` rule does _not_ cover IPv6. You need a separate `::/0` rule for each port.

### The gotchas (the actual adventure)

#### The propagation script that silently lied

I wrote a loop to wait for the AAAA records:

```bash
DOMAINS="app.example.com api.example.com ..."
for d in $DOMAINS; do ... done     # ran ONCE with the whole string
```

I was running in **zsh**. Unlike bash, **zsh does not word-split unquoted variables**. The entire domain list was treated as one "domain", so every iteration showed `(none)`. The script looked like DNS hadn't propagated for 10+ minutes when in reality **all records were live within seconds**.

**Fix:** iterate literals (`for d in dom1 dom2 dom3`) or use a zsh array. Classic bash→zsh portability trap.

#### Negative DNS caching broke SSH after propagation

After `ssh.example.com`'s AAAA propagated (verified via `dig @1.1.1.1`), `ssh -6 myvm` still failed:

```
ssh: Could not resolve hostname ssh.example.com: nodename nor servname provided
```

The local resolver had cached a **negative result** (NXDOMAIN) from the earlier lookup _before_ the record existed. `dig` sometimes bypasses the cache; `ssh` uses `getaddrinfo()` which respects it.

**Fix:**

```bash
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

**Lesson:** when testing a newly-added DNS record, if `dig` shows it but your app can't resolve it, **flush the local resolver cache**. Negative caching bites harder than positive caching.

#### The SSH hostname was a separate subdomain (near-lockout)

The `ssh myvm` alias pointed to `HostName ssh.example.com` — a **different subdomain** from the five web domains. It had an A record but **no AAAA record**.

If I had released the IPv4 EIP at that point, `ssh.example.com` would resolve to nothing → **complete SSH lockout**. No IPv4, no IPv6, no way in.

**Lesson:** **always enumerate _every_ hostname that points at the box** — web, SSH, monitoring, anything — before removing IPv4. I caught this one by checking the SSH config before the cutover, not after.

### Releasing the EIP — and the trap that followed

This is where "release the EIP, save $3.60" turned into an hour of work.

```bash
aws ec2 disassociate-address --public-ip <public-ipv4> --region <region>
aws ec2 release-address --allocation-id eipalloc-<allocation-id> --region <region>
```

The EIP released cleanly. But the instance **immediately grabbed a new, auto-assigned public IPv4**. An auto-assigned public IPv4 is billed at the **same $0.005/hr** — so I had saved exactly **nothing**.

**Root cause:** the instance's primary ENI was launched with `AssociatePublicIpAddress=True`, a **launch-time, immutable** attribute. There is **no CLI call to remove a public IPv4 from an existing instance**.

**The fix — rebuild the instance from an AMI:**

1. Stop the old instance (clean filesystem for a consistent AMI)
2. `create-image` from it → an AMI (~10 min for the 19 GB snapshot)
3. **Move the IPv6** to a fresh ENI created with `--no-associate-public-ip-address`
4. `run-instances` from the AMI, using the new ENI as the primary (`DeviceIndex=0`)
5. Same IPv6 (so DNS is untouched), identical software, **no public IPv4**
6. Verify, terminate the old instance

```bash
# The key flag that actually stops the charge
aws ec2 create-network-interface --subnet-id SUBNET --groups SG \
  --description "ipv6-only primary" --region REGION
```

Result: `PublicIpAddress: None`. The $3.60/mo was _actually_ gone.

#### cloud-init regenerated the SSH host key

The new instance — despite being from an AMI of the old one — presented a **different SSH host key**, triggering `REMOTE HOST IDENTIFICATION HAS CHANGED`. AWS AMIs run cloud-init on first boot, which **deletes and regenerates host keys** to guarantee uniqueness per instance.

**Fix:** `ssh-keygen -R ssh.example.com` then reconnect. Expected and safe when you control the instance — but a sharp edge when rebuilding from your own AMI.

---

### The hidden cost of IPv6-only: no IPv4 egress

This is the most important lesson in the whole story, and the one nobody warns you about.

**A VPC instance with no public IPv4 has no IPv4 internet access.** The Internet Gateway does not perform SNAT — for IPv4 outbound, the instance needs either a public IPv4 or a NAT Gateway. Neither exists now.

```bash
curl -4 https://1.1.1.1          → 000   (fails)
curl -4 https://ipv4.google.com  → 000   (fails)
curl -6 https://ipv6.google.com  → 200   (works)
```

The critical follow-up question: **which services the box actually depends on are IPv4-only?** Don't guess — test each one:

| Service                             | IPv6? | Consequence                           |
| ----------------------------------- | :---- | ------------------------------------- |
| npm (`registry.npmjs.org`)          | ✅    | `npm install` works                   |
| Docker (`registry-1.docker.io`)     | ✅    | `docker pull` works                   |
| Ubuntu apt (`archive.ubuntu.com`)   | ✅    | `apt update` works                    |
| **github.com**                      | ❌    | **`git push`/`git pull`/`gh` broken** |
| **api.github.com**                  | ❌    | **GitHub API broken**                 |
| **brand.site** (a proxied upstream) | ❌    | **nginx reverse-proxy broken**        |

**The good news:** the major package registries (npm, Docker Hub, Ubuntu) all have IPv6, so routine maintenance still works. DNS keeps working because AWS's VPC DNS resolver (`.2`) is reached over the **private** IPv4 network, not the internet.

**The real casualty:** **GitHub has no IPv6 at all.** Neither `github.com` nor `api.github.com` publish AAAA records. The box could no longer `git push`/`git pull`. This silently broke the on-box repo sync _and_ a 5-minute cron job. _The docs commit for this very write-up had to be pushed from a different machine with IPv4._

**The brutal trade-off:** restoring IPv4 egress requires either

- a **public IPv4** back on the instance ($3.60/mo — the exact cost I just cut), or
- a **NAT Gateway** (~$3.60/mo fixed + per-GB — _more_ than the public IP)

So "going IPv6-only to save $3.60" only works if **nothing on the box needs to talk to an IPv4-only host**. GitHub is the big one most people forget.

---

## The final cleanup (the resources that linger)

Every migration leaves a trail of snapshots, AMIs, and stopped instances that keep billing storage long after they're useful:

| Resource                                      | Action                 | Saves     |
| --------------------------------------------- | ---------------------- | --------- |
| Old instance + 20 GB EBS                      | terminated             | ~$1.22/mo |
| AMI + backing snapshot (migration safety net) | deregistered + deleted | ~$0.19/mo |
| RDS final snapshot                            | deleted                | ~$0.19/mo |
| Stale `pre-upgrade-172-to-179` RDS snapshot   | deleted                | ~$0.19/mo |

> **Deregistering an AMI does NOT delete its backing snapshot** — that's a separate `delete-snapshot` call people forget. A periodic `describe-snapshots` / `describe-images` / stopped-instances sweep is worth ~$2/mo on a small account.

---

## The generalized playbook

Hard-won, field-tested. In roughly the order I'd apply them:

1. **Read gross, not net.** Use Cost Explorer with `RECORD_TYPE` grouping. Ignore credits when planning — they're a deadline, not a discount.
2. **Break down by `USAGE_TYPE`, not just `SERVICE`.** `Amazon VPC` ≠ NAT gateway. `PublicIPv4:InUseAddress` is the real line item.
3. **Question every public IPv4.** $3.60/mo each. EC2 needs one; RDS usually doesn't (same-VPC traffic is private).
4. **Co-locate app + DB when data is small.** Managed RDS for three rows was ~$18/mo of waste. A local container is $0.
5. **Right-size ruthlessly, then add swap.** `t3a.small` + 2 GB swap beats `t3a.medium` for low-traffic apps.
6. **Hunt caches and stale clones.** `~/.npm`, `node_modules`, aborted git clones. They fill small EBS volumes to 100% and break everything — including the tools you'd use to clean them.
7. **Delete resources fully.** Deleting RDS must also remove the subnet group, security group, and release the EIP. (AWS auto-released the RDS-managed EIP on deletion — a nice surprise.)
8. **Take a final snapshot, then delete it once confident.** ~$0.10/mo for peace of mind during transition; remove it after the burn-in period.
9. **RIs / Savings Plans only after usage is stable and predictable.** For a single small instance, the absolute savings (~$4/mo) aren't worth the commitment yet.
10. **For IPv6-only: audit every outbound dependency.** The killer is GitHub. Package registries are fine; git-from-the-box is not.

---

## The honest trade-offs

This is **not** a universal recommendation. Self-hosting on a single tiny instance trades money for **operational burden and single-point-of-failure risk**:

- **No automatic failover.** If the EC2 dies, the app is down until I fix it.
- **You own backups.** The local postgres container must be backed up (cron `pg_dump` to the EBS, and ideally off-box).
- **You own patching.** OS, nginx, postgres, Node — all manual.
- **No horizontal scale.** A single `t3a.small` won't survive a traffic spike.

For a low-traffic NGO tool where cost matters more than 99.9% uptime, this is the right call. For a revenue-generating product, keep managed services. **Optimize for the constraints that actually apply to your workload.**

And the IPv6 piece specifically:

- **Financially**, going IPv6-only saved ~$5.40/mo total (the $3.60 EIP + ~$1.80 of orphaned storage) — about **$65/year**.
- **The effort** was ~2 hours, dominated by the _unanticipated_ auto-assigned-IP trap and the instance rebuild it forced.
- **The real cost** was GitHub: `git` from the box is dead, which broke two on-box automations. The compatibility cost of IPv6-only is the real price — and for GitHub-dependent workflows, it's higher than the $3.60 savings.

**Bottom line on IPv6:** do it for the learning and the future-proofing, not for the $3.60. And if you can't tolerate cutting off IPv4-only upstreams, **run dual-stack** (keep both A + AAAA records) — the compatibility cost of going IPv6-only is the real price, not the effort.

---

## The final state

| Component | Setup                                                                      |
| --------- | -------------------------------------------------------------------------- |
| App       | Next.js via systemd service on `:3000`                                     |
| DB        | `postgres:18-alpine` Docker container, named volume, `127.0.0.1:5432` only |
| Proxy     | nginx + Let's Encrypt, HTTP→HTTPS redirect                                 |
| DNS       | AAAA records → EC2 IPv6 (Cloudflare, DNS-only)                             |
| Instance  | `t3a.small` (2 vCPU, 2 GB) + 2 GB swap, 19 GB EBS at ~63%                  |
| Network   | IPv6-only public ingress, no public IPv4, no EIPs                          |

A workload that grossed **~$44/month** across Vercel and AWS now runs for the marginal cost of an EC2 I already paid for, with **zero** in managed-service surcharges, public-IP taxes, or vendor lock-in.

The money was the excuse. The real deliverable was a fluency in AWS cost mechanics, IPv6 networking, instance rebuilds, and the unglamorous art of debugging a full disk at 2 AM — none of which the console would have taught me.

---

_Credits hide costs. Caches fill disks. GitHub has no IPv6. And every "small" infrastructure change has outsized operational complexity. That's the real lesson._
