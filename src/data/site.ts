// Everything content-ish lives here so it can be edited without touching layout.

export const person = {
  name: "Sankalp Mukim",
  role: "Software engineer at IBM Cloud",
  home: "Delhi NCR",
  homeIcao: "VIDP",
  email: "sankalpmukim@gmail.com",
  intro:
    "Mostly-TypeScript full-stack generalist. At IBM Cloud I’m the main author of the agent platform that production AI Ops agents run on. Off the clock I chase mountains, airplanes and the occasional very silly side project.",
};

export const links = {
  github: "https://github.com/sankalpmukim",
  linkedin: "https://www.linkedin.com/in/sankalpmukim/",
  twitter: "https://twitter.com/IceCreamChai",
  instagram: "https://www.instagram.com/sankalpmukim/",
  email: "mailto:sankalpmukim@gmail.com",
  resume: "/resume.pdf",
  privacy: "/privacy-policy.pdf",
  terms: "/terms-of-use.pdf",
  rss: "/rss.xml",
};

export const nav = [
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/articles", label: "Articles" },
  { href: "/certifications", label: "Certifications" },
  { href: "/uses", label: "Uses" },
  { href: "/gallery", label: "Gallery" },
];

// Work history, rendered as a pilot's logbook.
export type LogEntry = {
  operator: string;
  role: string;
  from: string; // YYYY-MM
  to: string | null; // null = present
  remarks: string;
  logo?: string;
};

export const logbook: LogEntry[] = [
  {
    operator: "IBM",
    role: "Software Engineer",
    from: "2025-03",
    to: null,
    remarks:
      "IBM Cloud AI Ops. Main author of the agent platform behind production incident agents (~1.5M LLM calls, ~176k conversations a month); ask-iaas for L1 support; the BobOps VS Code extension.",
    logo: "/logos/IBM.png",
  },
  {
    operator: "ION",
    role: "Software Engineer",
    from: "2024-01",
    to: "2025-03",
    remarks:
      "Full-stack engineering on trading-domain products. Cut AWS spend by about half and owned IaC, CI/CD, database migrations and the monitoring suite.",
    logo: "/logos/iongroup_logo.jpeg",
  },
  {
    operator: "Streak (YC W22)",
    role: "Software Engineer",
    from: "2023-10",
    to: "2023-11",
    remarks: "Short stint at a YC fintech startup.",
    logo: "/logos/streakcard_logo.jpeg",
  },
  {
    operator: "North of Zero",
    role: "Backend Developer",
    from: "2023-06",
    to: "2023-08",
    remarks: "Backend services and APIs.",
    logo: "/logos/northOfZero.jpeg",
  },
  {
    operator: "Indiahikes",
    role: "Full Stack Engineer",
    from: "2022-10",
    to: "2023-01",
    remarks: "Built software for the trekking company whose treks I go on.",
    logo: "/logos/indiahikes.jpeg",
  },
  {
    operator: "IotReady",
    role: "React Engineer",
    from: "2021-01",
    to: "2021-03",
    remarks: "First internship. React dashboards for IoT devices.",
    logo: "/logos/iotReady.jpeg",
  },
];

// Projects, rendered as ATC flight progress strips.
export const stripKinds = ["tool", "learning", "client", "upstream"] as const;

export type StripKind = (typeof stripKinds)[number];

export type Project = {
  callsign: string; // short ident shown on the strip
  name: string;
  kind: StripKind;
  type: string; // language / platform
  route: string; // where it runs
  remarks: string;
  metric?: string;
  href: string;
  links?: { label: string; href: string }[];
  featured?: boolean;
  status?: "merged" | "open";
};

export const kindLabels: Record<StripKind, string> = {
  tool: "Tools I built",
  learning: "Learning by building",
  client: "Client sites",
  upstream: "Contributions to other projects",
};

export const projects: Project[] = [
  {
    callsign: "AWSAM",
    name: "AWS Accounts Manager",
    kind: "tool",
    type: "TypeScript",
    route: "Chrome, Edge, Firefox",
    remarks:
      "Client-side browser extension for securely managing and switching between AWS accounts. CI auto-publishes to all three stores.",
    metric: "250+ active users",
    href: "https://github.com/sankalpmukim/aws-accounts-manager",
    links: [
      {
        label: "Chrome Web Store",
        href: "https://chromewebstore.google.com/detail/aws-accounts-manager/hkcpaihoknnbgfaehgcihpidbkhmfacj",
      },
    ],
    featured: true,
  },
  {
    callsign: "ICDMCP",
    name: "IBM Cloud Docs MCP Server",
    kind: "tool",
    type: "JavaScript",
    route: "Any MCP client",
    remarks:
      "Lets AI clients search IBM Cloud documentation. Upstreamed into IBM’s official MCP collection.",
    metric: "In IBM’s official MCP registry",
    href: "https://github.com/sankalpmukim/ibm-cloud-docs-mcp-server",
    featured: true,
  },
  {
    callsign: "OCNTF2",
    name: "OpenCode Notifier v2",
    kind: "tool",
    type: "TypeScript",
    route: "OpenCode plugin",
    remarks:
      "Plays a sound and sends a desktop notification when an agent needs permission, finishes, or errors.",
    href: "https://github.com/sankalpmukim/opencode-notifier-v2",
    featured: true,
  },
  {
    callsign: "TOTP",
    name: "Simple TOTP Manager",
    kind: "tool",
    type: "TypeScript",
    route: "Chrome, Firefox",
    remarks:
      "Minimal authenticator with local secret storage, a live countdown and CSV export and import.",
    href: "https://github.com/sankalpmukim/simple-totp-manager",
    links: [
      {
        label: "Chrome Web Store",
        href: "https://chromewebstore.google.com/detail/simple-totp-manager/fbldnilamcajffalfgnfgbliedfpnofk",
      },
    ],
  },
  {
    callsign: "ZAIKEY",
    name: "oc-zai-key-manager",
    kind: "tool",
    type: "TypeScript",
    route: "OpenCode plugin",
    remarks:
      "Round-robins several z.ai coding-plan keys, detects quota exhaustion and retries automatically.",
    href: "https://github.com/sankalpmukim/oc-zai-key-manager",
  },
  {
    callsign: "HADLSP",
    name: "Hadolint LSP",
    kind: "tool",
    type: "JavaScript",
    route: "Any LSP editor",
    remarks: "Language server for Hadolint, so Dockerfile linting works in any LSP-capable editor.",
    href: "https://github.com/sankalpmukim/hadolint-lsp",
  },
  {
    callsign: "CTJSON",
    name: "forgot-content-type-json-header",
    kind: "tool",
    type: "TypeScript",
    route: "VS Code",
    remarks: "Catches the one header everyone forgets when POSTing JSON.",
    href: "https://marketplace.visualstudio.com/items?itemName=SankalpMukim.forgot-content-type-json-header",
  },
  {
    callsign: "RSSCRD",
    name: "RSS Card API",
    kind: "tool",
    type: "Cloudflare Worker",
    route: "Edge",
    remarks: "Turns any RSS feed into a themeable SVG card for a README or website.",
    href: "https://github.com/sankalpmukim/cf-rss-parser-readme",
  },
  {
    callsign: "YTLDGR",
    name: "YT Ledger",
    kind: "tool",
    type: "TypeScript",
    route: "Browser extension",
    remarks:
      "Tracks YouTube watch time like an expense manager: categories, auto-rules, insights, and budgets that can hide over-budget videos.",
    href: "https://github.com/sankalpmukim/yt-history-poc",
    featured: true,
  },
  {
    callsign: "NGXREF",
    name: "NGINX Reference",
    kind: "tool",
    type: "nginx",
    route: "Your VPS",
    remarks: "A curated cookbook of production nginx configurations, organised by use case.",
    href: "https://github.com/sankalpmukim/nginx-reference",
  },
  {
    callsign: "VK100",
    name: "Kohli Hundreds",
    kind: "tool",
    type: "Next.js",
    route: "Vercel",
    remarks:
      "A live tracker for Virat Kohli’s international hundreds and his status in any ongoing India ODI.",
    href: "https://viratkohlicenturytracker.vercel.app",
  },
  {
    callsign: "HTTPTCP",
    name: "HTTP from TCP",
    kind: "learning",
    type: "Go",
    route: "VPS, in production",
    remarks:
      "An HTTP/1.1 server written from scratch on raw TCP sockets. It still serves http.sankalpmukim.dev.",
    href: "https://github.com/sankalpmukim/httpfromtcp",
    links: [{ label: "Live", href: "https://http.sankalpmukim.dev" }],
    featured: true,
  },
  {
    callsign: "MYRCT",
    name: "my-react",
    kind: "learning",
    type: "TypeScript",
    route: "Browser",
    remarks: "A from-scratch React and JSX API, built to understand what React actually does.",
    href: "https://github.com/sankalpmukim/my-react",
  },
  {
    callsign: "MTSCAM",
    name: "MonkeyType Scam",
    kind: "learning",
    type: "JavaScript",
    route: "Browser",
    remarks:
      "One fun evening poking at accessibility tooling and gaming MonkeyType into a record score.",
    href: "https://github.com/sankalpmukim/monkeytype-scam",
  },
  {
    callsign: "NUMPUZ",
    name: "Numpuz",
    kind: "learning",
    type: "React, Firebase",
    route: "numpuz.sankalpmukim.dev",
    remarks:
      "Multiplayer number puzzle with a real-time leaderboard. Built to learn React and WebSockets.",
    href: "https://numpuz.sankalpmukim.dev",
    links: [{ label: "Source", href: "https://github.com/sankalpmukim/numpuz-with-react" }],
  },
  {
    callsign: "RODEO",
    name: "The Rodeo Lane",
    kind: "client",
    type: "Site + ERP",
    route: "Varanasi",
    remarks:
      "Site and ERP for a high-end car detailing studio: memberships, coupons, GST billing, service reminders.",
    href: "https://www.therodeolane.com",
  },
  {
    callsign: "VARDA",
    name: "Vardasustain Consulting",
    kind: "client",
    type: "Website",
    route: "Web",
    remarks: "Website for a sustainability consulting practice.",
    href: "https://nm-ogss-website-frontend.vercel.app",
  },
  {
    callsign: "RKSTN",
    name: "Rock & Stone",
    kind: "client",
    type: "Website",
    route: "Web",
    remarks: "Website for a natural-stone company serving architects, builders and homeowners.",
    href: "https://rockandstone-website.vercel.app",
  },
  {
    callsign: "THNDR",
    name: "Thunder Brand Solutions",
    kind: "client",
    type: "Website",
    route: "Web",
    remarks: "Website for a branding agency.",
    href: "https://thunder-brand-website.vercel.app",
  },
  {
    callsign: "SONCH",
    name: "Son Chiraiya",
    kind: "client",
    type: "Website",
    route: "Varanasi",
    remarks: "Website for an Indian restaurant.",
    href: "https://sonchiraiya.co",
  },
  {
    callsign: "CF178",
    name: "cloudflare/vinext #178",
    kind: "upstream",
    type: "TypeScript",
    route: "cloudflare/vinext",
    remarks: "Standalone self-host output, plus aligned production scripts in init.",
    href: "https://github.com/cloudflare/vinext/pull/178",
    status: "merged",
  },
  {
    callsign: "IBMREG",
    name: "IBM MCP registry",
    kind: "upstream",
    type: "JavaScript",
    route: "IBM/mcp",
    remarks:
      "Public open-source contribution: the IBM Cloud Docs MCP server, added to IBM’s official registry.",
    href: "https://github.com/IBM/mcp/pull/7",
    status: "merged",
  },
  {
    callsign: "KBN627",
    name: "elastic/kibana #221627",
    kind: "upstream",
    type: "TypeScript",
    route: "elastic/kibana",
    remarks: "Fixed a grammar typo in an error message. Every bit counts.",
    href: "https://github.com/elastic/kibana/pull/221627",
    status: "merged",
  },
  {
    callsign: "TWIN72",
    name: "tailwindcss-intellisense #1572",
    kind: "upstream",
    type: "TypeScript",
    route: "tailwindlabs",
    remarks: "A “Fix all auto-fixable problems” command.",
    href: "https://github.com/tailwindlabs/tailwindcss-intellisense/pull/1572",
    status: "open",
  },
  {
    callsign: "DRZL58",
    name: "drizzle-lab #58",
    kind: "upstream",
    type: "TypeScript",
    route: "rphlmr/drizzle-lab",
    remarks: "Bezier edges for the schema visualiser.",
    href: "https://github.com/rphlmr/drizzle-lab/pull/58",
    status: "open",
  },
  {
    callsign: "PSDB14",
    name: "planetscale/database-skills #14",
    kind: "upstream",
    type: "Markdown",
    route: "planetscale",
    remarks: "A SQLite skill, surfaced across the docs and site.",
    href: "https://github.com/planetscale/database-skills/pull/14",
    status: "open",
  },
];

export const certifications = [
  {
    title: "AWS Certified Solutions Architect – Associate",
    issuer: "Amazon Web Services",
    code: "SAA-C03",
    group: "Cloud",
    description:
      "Designing available, cost-efficient, fault-tolerant and scalable distributed systems on AWS.",
    href: "/certifications/saa-c03.pdf",
  },
  {
    title: "Fundamentals of Networking",
    issuer: "Hussein Nasser, Udemy",
    code: "NET-FUND",
    group: "Theory",
    description:
      "First principles of networking for building low-latency, high-throughput backends.",
    href: "/certifications/udemy-networking.pdf",
  },
  {
    title: "NGINX Fundamentals",
    issuer: "Hussein Nasser, Udemy",
    code: "NGX-FUND",
    group: "Theory",
    description:
      "Layer 4 and layer 7 load balancing, WebSockets, HTTPS, HTTP/2 and TLS 1.3 with NGINX.",
    href: "/certifications/udemy-nginx.pdf",
  },
];

export const uses: { group: string; items: { name: string; href?: string; note: string }[] }[] = [
  {
    group: "Agents and models",
    items: [
      {
        name: "T3 Code",
        href: "https://t3.codes/",
        note: "Where most of my agent-driven work happens now. Several providers, one window.",
      },
      {
        name: "OpenCode",
        href: "https://opencode.ai/",
        note: "Open-source coding agent. I write plugins for it, which says enough.",
      },
      { name: "GrokBot", href: "https://x.ai/bot", note: "A second opinion that argues back." },
      {
        name: "GLM-5.3, Grok 4.6 and 4.7, local LLMs",
        note: "The rotation. Local models for anything I would rather not send anywhere.",
      },
      {
        name: "Hex",
        href: "https://github.com/anomalyco/hex",
        note: "Local voice dictation from the OpenCode team. Half of my prompts are spoken.",
      },
    ],
  },
  {
    group: "Terminal and editor",
    items: [
      {
        name: "Fish",
        note: "Sane defaults, great completions, and I have not missed bash syntax once.",
      },
      {
        name: "GitHub CLI",
        note: "Repos, issues and pull requests without leaving the terminal. Also how this site got its content.",
      },
      {
        name: "Visual Studio Code",
        note: "Still the editor I am fastest in, now mostly for reading what agents wrote.",
      },
    ],
  },
  {
    group: "Flight sim",
    items: [
      {
        name: "X-Plane",
        note: "GA flying with an eye on real-world procedures rather than autopilot buttons.",
      },
      {
        name: "Logitech Extreme 3D Pro",
        note: "The joystick. Not a yoke, but it gets the job done.",
      },
      { name: "VATSIM", note: "Flying online with real (human) air traffic controllers." },
    ],
  },
  {
    group: "Desk",
    items: [
      {
        name: "BenQ GW2480T, 24 inch",
        note: "Height-adjustable, honest panel, no complaints in years.",
      },
    ],
  },
];

// Gallery. `src` can be any image in /public. Placeholders render as chart tiles.
export type Photo = { src?: string; alt: string; caption: string; place?: string; tall?: boolean };

export const photos: Photo[] = [
  {
    src: "/photos/gallery-kuari-campsite.jpg",
    alt: "Tents at the Kuari Pass campsite glowing in golden-hour light",
    caption: "Kuari Pass camp at golden hour",
    place: "Kuari Pass, Uttarakhand",
    tall: true,
  },
  {
    src: "/photos/gallery-kuari-viewpoint.jpg",
    alt: "A person looking out at snow-covered Himalayan peaks on the Kuari Pass trek",
    caption: "Looking out on the Lord Curzon Trail",
    place: "Kuari Pass",
    tall: true,
  },
  {
    src: "/photos/gallery-kuari2-snow-trail.jpg",
    alt: "A forest trail under snow on the Kuari Pass trek",
    caption: "Forest trail under snow",
    place: "Kuari Pass, Uttarakhand",
  },
  {
    src: "/photos/gallery-kuari-summit-day.jpg",
    alt: "A trekker ascending an alpine meadow on the Kuari Pass trek; on-frame story text reads “Day 4 - Summit day.”",
    caption: "The frame the story called summit day",
    place: "Kuari Pass, Uttarakhand",
  },
  {
    src: "/photos/gallery-hampta-done.jpg",
    alt: "Trek group holding an IndiaHikes DONE! banner at Hampta Pass, about 14,100 ft",
    caption: "DONE! at Hampta Pass",
    place: "Hampta Pass, Himachal Pradesh",
  },
  {
    src: "/photos/gallery-hampta-jwara.jpg",
    alt: "Jwara campsite sign on the Hampta Pass trek, reading 11,005 ft / 3,354 m",
    caption: "Jwara camp, 11,005 ft",
    place: "Hampta Pass trek, Himachal Pradesh",
  },
  {
    src: "/photos/gallery-bhrigu-tent.jpg",
    alt: "A yellow tent pitched at a mountain camp on the Bhrigu Lake trek",
    caption: "Camp on the Bhrigu Lake trek",
    place: "Bhrigu Lake trek, Himachal Pradesh",
  },
  {
    src: "/photos/gallery-gaumukh-fox.jpg",
    alt: "A fox on the road from Dehradun to Gangotri, near Rawat Restaurant",
    caption: "Roadside fox on the way to Gangotri",
    place: "Dehradun → Gangotri",
  },
  {
    src: "/photos/gallery-gaumukh-gangotri-arch.jpg",
    alt: "The entrance arch at Gangotri, where the walk towards Gaumukh begins",
    caption: "Through the arch, the trek begins",
    place: "Gangotri, Uttarakhand",
  },
  {
    src: "/photos/gallery-gaumukh-gangotri-sign.jpg",
    alt: "IndiaHikes sign at Gangotri reading 10,050 ft / 3,063 m",
    caption: "Gangotri, 10,050 ft",
    place: "Gangotri, Uttarakhand",
  },
  {
    src: "/photos/gallery-gaumukh-bhagirathi.jpg",
    alt: "The Bhagirathi river running through the valley near Uttarkashi on the Gaumukh approach",
    caption: "The Bhagirathi, en route to Gaumukh",
    place: "Near Uttarkashi, Uttarakhand",
  },
  {
    src: "/photos/gallery-train-coding.jpg",
    alt: "A laptop open on a train berth, code on screen",
    caption: "Building on a 33-hour train",
    place: "KSR → NZM, Mar 2026",
  },
  {
    src: "/photos/gallery-india-gate-dog.jpg",
    alt: "A dog resting in front of parked bicycles near India Gate",
    caption: "Bicycle convoy, one very relaxed dog",
    place: "India Gate, Delhi",
  },
  {
    src: "/photos/gallery-night-bike.jpg",
    alt: "A mountain bike after a dusty evening ride",
    caption: "The bike, after a dusty ride",
    place: "Delhi NCR",
    tall: true,
  },
  {
    src: "/photos/gallery-kuari-book.jpg",
    alt: "A paperback of The Hundred-Year-Old Man resting against mountain scenery at Kuari Pass",
    caption: "Hundred-Year-Old Man, mountain edition",
    place: "Kuari Pass",
    tall: true,
  },
  {
    src: "/photos/gallery-graduation.jpg",
    alt: "Graduation day at VIT Vellore",
    caption: "VIT graduation, 2024",
    place: "Vellore",
  },
  {
    src: "/photos/gallery-train-platform.jpg",
    alt: "A train platform at night under the lights",
    caption: "Night train somewhere on the map",
    place: "Indian Railways",
  },
];

// Labels painted on the hero chart. Names are feed- and highlight-evidenced
// trek places, not summits logged. The one elevation is taken from the
// IndiaHikes DONE! banner at Hampta Pass (~14,100 ft / 4,287 m); the rest stay
// name-only until a sign or banner puts a number on them.
export type Peak = { name: string; elevation?: number };

export const peaks: Peak[] = [
  { name: "Kuari Pass" },
  { name: "Hampta Pass", elevation: 4287 },
  { name: "Bhrigu Lake" },
  { name: "Gaumukh Tapovan" },
];

// Obstacles in the pelican game. Drop a real logo at `img` (e.g. /ai-logos/openai.svg)
// and it will be drawn instead of the placeholder glyph.
export const aiObstacles = [
  { name: "OpenAI", glyph: "knot", color: "#142A4C", img: "" },
  { name: "Anthropic", glyph: "asterisk", color: "#A8145F", img: "" },
  { name: "DeepMind", glyph: "sparkle", color: "#2457A6", img: "" },
  { name: "Meta", glyph: "loop", color: "#2457A6", img: "" },
  { name: "Mistral", glyph: "blocks", color: "#C46A12", img: "" },
  { name: "xAI", glyph: "cross", color: "#142A4C", img: "" },
  { name: "DeepSeek", glyph: "wave", color: "#2457A6", img: "" },
  { name: "Perplexity", glyph: "grid", color: "#1E6B5C", img: "" },
];
