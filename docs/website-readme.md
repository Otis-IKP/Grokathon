# Yale NEPO website

> Converted from `Read me - Grokathon.docx`. The Word file had the default create-next-app README
> interleaved line by line with this one; those boilerplate lines (Next.js links, `next/font`, the
> `yarn`/`pnpm`/`bun` alternatives, the Vercel template blurb) are left out. Everything else is the
> original text. The site has since been rebuilt in Astro in [`website/`](../website/); see
> [`website/README.md`](../website/README.md) for how the rebuild maps to this spec.

Marketing site for Yale NEPO. Two pages only: a short welcome page and a longer “how it works” page. Sign-in, friends, clubs, and the bot live in the app, not here.

## Recreate it

```bash
npx create-next-app@latest yale-nepo-web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd yale-nepo-web
npm install -D @tailwindcss/postcss
```

Add `postcss.config.mjs` in the project root:

```js
const config = {
 plugins: {
   "@tailwindcss/postcss": {},
 },
};
export default config;
```

Tailwind v4 will not generate utility classes without that file. The page will look unstyled even if the build succeeds.

Copy these paths from this repo into the new one, replacing the starter files where names match:

```text
src/app/globals.css
src/app/layout.tsx
src/app/page.tsx
src/app/how/page.tsx
src/components/
src/lib/
public/images/yale-harkness.jpg
public/images/yale-branford.jpg
postcss.config.mjs
```

Then:

```bash
npm run dev
```

Open http://127.0.0.1:3000 and http://127.0.0.1:3000/how.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Welcome. Yale-blue rounded hero, one campus photo, three steps. |
| `/how` | Longer explanation: what a student does, the Maya → YSIG sample graph, where club data comes from, privacy. |

There is no sign-up form. “Get started” belongs on the app’s `/login` page once that URL exists.

## Look

- Yale blue `#00356B` on a light page. The hero is a rounded navy panel, not a full-screen photo.
- Wordmark is `Yale` plus `NEPO`, with a line through the middle of NEPO.
- The Yale Y sits small in the corner of the navy panel. It is not next to the wordmark and it is not a wallpaper.
- Photos are small rounded frames. Home uses Harkness Tower. `/how` uses Branford Court.
- Copy stays plain. The home page does not show the friend graph.

## Photos

Both files are public-domain images from Wikimedia Commons. Keep them in `public/images/`.

- `yale-harkness.jpg` — Harkness Tower, Carol M. Highsmith (Library of Congress)
- `yale-branford.jpg` — Branford Court and Harkness Tower (Library of Congress)

## Later, when the app is deployed

`src/lib/config.ts` reads:

```bash
NEXT_PUBLIC_APP_URL=https://the-app-url
NEXT_PUBLIC_GRAPH_SHARE_TOKEN=
```

Put those in `.env.local`. Do not commit that file. The graph on `/how` currently draws the sample in `src/lib/demo-graph.ts`. When Otis’s endpoint is live, that same visual can load `GET {APP_URL}/api/public/graph/{share_token}`.
