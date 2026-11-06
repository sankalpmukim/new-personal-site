# anti-slop provenance

Source repository: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)

Copied snapshot: commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (`Merge pull request #36 from K-Mistele/contrib/effect-tag-match-rules`). Byte-identical to `skills/install-anti-slop/assets/anti-slop` at that commit. Verified by recursive file comparison after install.

Local skill bundle used for the copy:

- path: `~/.agents/skills/install-anti-slop`
- source URL: `https://github.com/dmmulroy/anti-slop.git`
- skill folder hash: `89044d21c75a367eac1ddbaf208e650b1a7d5820`
- installed at: 2026-10-13

Installed plugin paths:

- generic entry: `tools/oxlint/anti-slop/index.ts`
- Effect entry (copied, not registered): `tools/oxlint/anti-slop/effect/index.ts`
- nested Stylistic vendor record: `tools/oxlint/anti-slop/vendor/eslint-stylistic/UPSTREAM.md`

Intentional deviations from that snapshot: none. This repository does not depend on `effect`, so the Effect plugin is present on disk and is not enabled in `oxlint.config.ts`.

Verification (2026-11-07):

- `pnpm check` (`astro check`): 0 errors, 0 warnings
- `pnpm lint`: fails on existing application source (337 problems). Findings were not auto-fixed.
