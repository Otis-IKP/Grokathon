# Yale NEPO website

The marketing site at **https://yalenepo.xyz**. Two pages: a short welcome page (`/`) and a longer
"how it works" page (`/how`). Sign-in, friends, clubs and the inbox live in the app; texting lives in the bot.

Built with [Astro](https://docs.astro.build) as a static site and hosted on Vercel. This is a rebuild of
Arden's Next.js site from its README ([`docs/website-readme.md`](../docs/website-readme.md)).

## Run it

Needs Node 22.23 or newer. This folder uses npm and has its own `package.json`, separate from the app in
the repo root.

```bash
cd website
npm install
npm run dev        # http://localhost:4321
npm run build      # type-checks, then writes the static site to dist/
npm run preview    # serves dist/
```

## Settings

All optional. Copy `.env.example` to `.env` for local work (it is gitignored). On Vercel, set the same names
under Project → Settings → Environment Variables.

| Variable | What it does |
| --- | --- |
| `PUBLIC_APP_URL` | The app's origin, for example `https://app.yalenepo.xyz`. When set, the site shows "Sign in" and "Sign in with Yale" links to `{PUBLIC_APP_URL}/login`, plus a link to the app's privacy page. Leave it empty until the app is deployed. |
| `PUBLIC_GRAPH_SHARE_TOKEN` | A path share token from the app. With `PUBLIC_APP_URL`, the graph on `/how` loads that real path instead of the sample. |
| `PUBLIC_BOT_PHONE` | The number students text. Defaults to `+1 645 243 7121`. |

These values are baked in at build time, so redeploy after changing them.

**Showing a real path.** In the app, run a search and press "Share this path", which calls
`POST /api/paths/{searchId}/share`. Copy the token into `PUBLIC_GRAPH_SHARE_TOKEN` and redeploy. The page
fetches `GET {PUBLIC_APP_URL}/api/public/graph/{token}` in the browser, so the app must set
`WEBSITE_ORIGIN=https://yalenepo.xyz` for CORS. Tokens expire after 24 hours; when one fails, the page
quietly keeps the sample graph.

## Deploy on Vercel with yalenepo.xyz

1. In Vercel, choose **Add New → Project** and import `Otis-IKP/Grokathon`.
2. Set **Root Directory** to `website`. Vercel detects Astro and fills in `npm run build` and `dist`.
3. Add any environment variables from the table above, then deploy.
4. Under **Settings → Domains**, add `yalenepo.xyz` and `www.yalenepo.xyz`, and choose to redirect `www`
   to the apex.
5. At your domain registrar, create the DNS records Vercel shows on that page. Usually that is an `A` record
   for `yalenepo.xyz` pointing to `76.76.21.21`, and a `CNAME` for `www` pointing to `cname.vercel-dns.com`.
   Alternatively, switch the domain's nameservers to Vercel's. HTTPS certificates are issued automatically
   once DNS resolves.

The canonical URLs and the social preview image already use `https://yalenepo.xyz` (`site` in
`astro.config.mjs`).

## How it maps to the original spec

| Spec | Here |
| --- | --- |
| `/`: Yale-blue rounded hero, one campus photo, three steps | `src/pages/index.astro` |
| `/how`: what a student does, the Maya → YSIG sample graph, club data sources, privacy | `src/pages/how.astro` |
| Yale blue `#00356B` on a light page | `src/styles/global.css` |
| Wordmark `Yale` + `NEPO` with a line through NEPO | `src/components/Wordmark.astro` |
| Small Y in the corner of the navy panel | `src/components/YMark.astro`, set as a serif letter rather than Yale's logo artwork |
| Small rounded photo frames | `src/components/Photo.astro` |
| `src/lib/config.ts`, `src/lib/demo-graph.ts` | The same files; the drawing code is in `src/lib/graph.ts` |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GRAPH_SHARE_TOKEN` | `PUBLIC_APP_URL`, `PUBLIC_GRAPH_SHARE_TOKEN`, declared with `astro:env` in `astro.config.mjs` |
| No sign-up form | Correct. The main action is "Text NEPO", an `sms:` link. Sign-in links appear only once `PUBLIC_APP_URL` is set. |

The graph draws in two layouts from one function: a wide one for desktop and a stacked one for phones.
The same code renders the sample at build time and redraws a live path in the browser.

## Photos

Both are public domain, from Wikimedia Commons, resized to 1200 px wide and kept in `public/images/`.

- `yale-harkness.jpg`: [Harkness Tower from Old Campus](https://commons.wikimedia.org/wiki/File:Harkness_Tower_Canopy_Highsmith.jpg),
  by Carol M. Highsmith, Library of Congress (`highsm.19222`).
- `yale-branford.jpg`: [Branford Court and Harkness Tower](https://commons.wikimedia.org/wiki/File:Branford_Court_and_Harkness_Tower,_Yale_University,_New_Haven,_Conn_(61775).jpg),
  a Tichnor Brothers postcard in the Boston Public Library collection, cropped to the painted view.
  The original README credited this one to the Library of Congress. No Library of Congress photo of Branford
  Court was found on Commons, so this public-domain postcard is used and credited correctly.

The footer says the site is a student project, not affiliated with or endorsed by Yale University.
