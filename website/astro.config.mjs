// @ts-check
import { defineConfig, envField } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://yalenepo.xyz",
  env: {
    schema: {
      // The app's public origin, no trailing slash. When set, the site links "Sign in with Yale"
      // to {PUBLIC_APP_URL}/login and the privacy note to {PUBLIC_APP_URL}/privacy.
      PUBLIC_APP_URL: envField.string({ context: "client", access: "public", optional: true }),
      // A share token from the app (POST /api/paths/{searchId}/share). When set together with
      // PUBLIC_APP_URL, the graph on /how loads that real path instead of the sample.
      PUBLIC_GRAPH_SHARE_TOKEN: envField.string({ context: "client", access: "public", optional: true }),
      // The number students text.
      PUBLIC_BOT_PHONE: envField.string({ context: "client", access: "public", default: "+1 645 243 7121" }),
    },
  },
});
