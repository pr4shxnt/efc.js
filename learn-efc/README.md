# learn.efc — The backend handbook

An article-first course that teaches backend development from scratch, then compares traditional Express 5 with Express File Cluster 0.12.0.

The curriculum is deliberately ordered:

1. Web foundations: setting up Node and a terminal, clients, servers, ports, HTTP, APIs, and JSON.
2. Node.js and Express: JavaScript prerequisites, a native HTTP server, Express setup, routing, middleware, errors, and environment variables.
3. EFC and databases: file-based routes, persistence concepts, a first scaffolded EFC project, schema validation, database connections, and model queries.
4. Production essentials: authentication, background tasks, initialization and workers, CORS, testing, security basics, and deployment.

There are 24 chapters. Each one has a "Words to know" list, a hands-on exercise with the expected result, and a quiz; the HTTP chapter also has an embedded request simulator. Express/EFC comparisons show both approaches and explain their shared concepts. Sketches that require app-owned integrations are labeled explicitly. Playground data is simulated in the browser.

## Run locally

```sh
cd learn-efc
npm install
npm run dev -- --hostname 127.0.0.1
```

Use the local URL printed by Next.js. To verify changes:

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
```

## Deployment

The repository workflow `.github/workflows/learn-efc-deploy.yml` has three sequential
jobs: lint/typecheck/content tests, standalone build with HTTP smoke tests, and deployment.
Pull requests run the first two jobs. Changes to this app on upstream `main` deploy after
both pass; manual runs deploy only from upstream `main`. The existing framework CI is separate.
The npm publication workflow runs when a framework package manifest changes, so
website-only deployments do not attempt to republish the existing npm versions.
It follows [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
and passes the tested tarball between jobs using [GitHub Actions artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).

The deployment uses repository Actions secrets `LEARN_EFC_SSH_HOST`,
`LEARN_EFC_SSH_USER`, and `LEARN_EFC_SSH_PRIVATE_KEY`. The server's public SSH host key
is pinned in `deploy/known_hosts`; verify any replacement key before updating that file.
No private key belongs in the repository.

One-time server prerequisites for `ubuntu@130.210.62.210`:

- An x86_64 Ubuntu host with Node.js **24** available at `/opt/learn-efc-node/bin/node`, plus `curl`, `tar`, and Nginx.
  Install Node.js from a trusted distribution and point `/opt/learn-efc-node` at that distribution's directory.
  The current host uses `/opt/node-v24.22.2`. This dedicated runtime keeps the service
  independent of Ubuntu's older `/usr/bin/node`, which an `apt install nodejs npm` can replace.
  Check `/opt/learn-efc-node/bin/node --version` before deployment.
- Passwordless `sudo` for the deployment user to restart/stop `learn-efc.service` and
  inspect it with `systemctl cat`. The current Ubuntu user already has passwordless sudo.
- The service and proxy configuration below. Run from the repository root on your computer
  after installing Node.js on the server:

```sh
scp learn-efc/deploy/learn-efc.service learn-efc/deploy/nginx.conf learn-efc:/tmp/
ssh learn-efc
sudo ln -sfn /opt/node-v24.22.2 /opt/learn-efc-node
sudo install -d -o ubuntu -g ubuntu /var/www/learn-efc/releases
sudo chown ubuntu:ubuntu /var/www/learn-efc
sudo install -m 644 /tmp/learn-efc.service /etc/systemd/system/learn-efc.service
sudo install -m 644 /tmp/nginx.conf /etc/nginx/sites-available/learn-efc
sudo ln -sfn /etc/nginx/sites-available/learn-efc /etc/nginx/sites-enabled/learn-efc
sudo systemctl daemon-reload
sudo systemctl enable learn-efc.service
sudo nginx -t && sudo systemctl reload nginx
```

The service starts on the first deployment; it listens on `127.0.0.1:3000`, behind Nginx.
The supplied proxy handles the server IP on HTTP port 80. For a domain, update `server_name`
and configure TLS before using HTTPS. Ensure the hosting firewall permits HTTP/HTTPS.

Each deployment unpacks to `/var/www/learn-efc/releases/<commit>-<run>-<attempt>`, switches
the `current` symlink, and restarts `learn-efc.service`. A failed startup or health check
restores the previous release when one exists and fails the job. Deployments run one at
a time and never cancel an active deployment. Old releases are retained for rollback;
remove unused ones periodically, keeping the current and previous release.
No dependencies are installed and no build runs on the server. Check logs with
`sudo journalctl -u learn-efc.service -n 100`.

Keep the `learn-efc/` app and its deployment workflow versioned together so CI can
build the same source that was reviewed.

## SEO and deployment

The site is served at http://130.210.62.210/. `lib/site.ts` holds that URL; every canonical link, Open Graph URL, sitemap entry, share-image hostname and JSON-LD id is built from it, so change it there if the domain moves.

- Icons: `app/favicon.ico`, `app/icon.svg` and `app/apple-icon.png` are the EFC favicon set (copied from `client/assets`); `public/icon-192.png` and `icon-512.png` back `app/manifest.ts`.
- Metadata: `pageMetadata()` in `lib/site.ts` gives each page its title, description, canonical URL, Open Graph and Twitter card. Chapters are `article`s.
- Share images: `app/opengraph-image.tsx` and `app/learn/[slug]/opengraph-image.tsx` render 1200×630 PNGs at build time with the TTFs in `assets/fonts` (SIL OFL).
- Crawlers: `app/robots.ts`, `app/sitemap.ts` (home, 24 chapters, tools, glossary), and JSON-LD (`lib/structured-data.ts`: WebSite + Course on the home page, TechArticle/LearningResource + BreadcrumbList on chapters).
- AI tools: `/llms.txt` lists every chapter; `/llms-full.txt` contains the full text.

`npm run build` prerenders every page and image, but it is not a static export: run it with `npm start` on Node or deploy to a host that runs Next.js.

## Content and design

- `lib/tutorials.ts`: the original chapters, chapter order (`ORDER`), and the deterministic quiz shuffle.
- `lib/new-chapters.ts`: setup, environment variables, first EFC project, validation, testing, and security chapters.
- `lib/practice.ts`: per-chapter exercises, key terms (which also build the glossary), and rewritten EFC quizzes.
- `lib/efc-data.ts`: existing EFC reference data and simulator presets.
- `lib/highlight.tsx`: a small JS/TS/SQL/shell tokenizer for code blocks (React text nodes only).
- `components/AppShell.tsx`: header, search, footer, reading progress, and the progress context; mounted by `app/layout.tsx`.
- `components/ui.tsx`: shared building blocks: `CodeBlock`, `PageHeader`, `Panel`, `Segmented`, `MethodTag`, `ToolIntro`.
- `components/Navbar.tsx`: site header, mobile drawer, chapter list, theme toggle, and `NAV_ITEMS` (with each tool's URL).
- `components/QuestsSection.tsx`: the handbook index (`Library`) and the chapter reader (`Reader`).
- `app/globals.css`: design tokens and every component style; no utility classes.

URLs are real routes: `/` (handbook), `/learn/<chapter-id>`, `/routes`, `/database`, `/tasks`, `/guard`, `/reference`, and `/glossary`. Every chapter is prerendered with `generateStaticParams` and has its own title and description. Old hash links (`/#learn/<id>`, `/#tasks`, …) redirect to the new paths. Reading progress and the theme choice stay in this browser's local storage under the same keys as before, so existing progress carries over. There is no account or server-side progress synchronization.

To add a chapter, add it to `lib/new-chapters.ts` (or `CHAPTERS` in `lib/tutorials.ts`), give it an exercise and terms, and put its id in `ORDER`. Write quiz options with the correct answer first; the shuffle moves it.

The visual language follows the EFC site: a warm dark palette with `#F0A030` as the single accent, plus a light "paper" theme that follows the system setting or the header toggle. Type is Inter (text), JetBrains Mono (code) and Instrument Serif italic (accents only), loaded with `next/font`, which self-hosts them at build time, so the running site makes no requests to font CDNs (the build itself needs network access to fetch them). Colours live as tokens on `:root`; add new ones in both themes. Keep away from decorative chrome (gradients, glows, pill badges, fake window dots, all-caps eyebrow labels).

EFC examples should be checked against the repository's `Skills/efc/` and `docs/` before modification. Express references target version 5.
