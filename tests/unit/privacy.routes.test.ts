import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Privacy rule 1: every API route requires a CAS session (or the bot / cron
 * secret), except the CAS routes and the token-gated graph endpoint. This
 * scans every route file so a new unguarded handler fails the build.
 */
const API_DIR = path.join(process.cwd(), "src/app/api");
const APP_DIR = path.join(process.cwd(), "src/app");

function walk(dir: string, name: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, name);
    return entry.name === name ? [full] : [];
  });
}

const PUBLIC_ALLOWLIST = new Set([
  "auth/cas/login/route.ts",
  "auth/cas/callback/route.ts",
  "auth/dev-login/route.ts", // refused unless DEV_LOGIN_ENABLED, and always in production
  "auth/logout/route.ts",
  "public/graph/[share_token]/route.ts", // gated by a 24-hour share token
]);

const REQUIRED_WRAPPER: [RegExp, string][] = [
  [/^bot\//, "botRoute"],
  [/^admin\//, "adminRoute"],
  [/^internal\//, "cronRoute"],
  [/^(auth|public)\//, "publicRoute"],
  [/.*/, "appRoute"],
];

describe("every API route is guarded", () => {
  const routes = walk(API_DIR, "route.ts");

  test("there are routes to check", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  test.each(routes.map((file) => [path.relative(API_DIR, file).split(path.sep).join("/"), file]))("%s", (rel, file) => {
    const source = fs.readFileSync(file, "utf8");
    const exports = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) = (\w+)\(/g)];
    // Every HTTP method export must be built with a wrapper from server/api/route.ts.
    const rawExports = [...source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)];
    expect(rawExports, "handlers must be built with a route wrapper").toEqual([]);
    expect(exports.length).toBeGreaterThan(0);

    const expected = REQUIRED_WRAPPER.find(([pattern]) => pattern.test(rel))![1];
    for (const [, method, wrapper] of exports) {
      expect(wrapper, `${method} in ${rel}`).toBe(expected);
      if (wrapper === "publicRoute") expect(PUBLIC_ALLOWLIST.has(rel), `${rel} is not on the public allowlist`).toBe(true);
    }
  });

  test("the public allowlist has no stale entries", () => {
    const rels = new Set(routes.map((file) => path.relative(API_DIR, file).split(path.sep).join("/")));
    for (const entry of PUBLIC_ALLOWLIST) expect(rels.has(entry), entry).toBe(true);
  });
});

describe("every page is behind sign-in", () => {
  test("the (app) layout and the /i/[token] page call pageUser, which redirects to /login", () => {
    const layout = fs.readFileSync(path.join(APP_DIR, "(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/await pageUser\(/);
    const token = fs.readFileSync(path.join(APP_DIR, "i/[token]/page.tsx"), "utf8");
    expect(token).toMatch(/await pageUser\(/);
    const admin = fs.readFileSync(path.join(APP_DIR, "(app)/admin/page.tsx"), "utf8");
    expect(admin).toMatch(/await pageAdmin\(/);
  });

  test("the only pages outside the authenticated shell are login, privacy and the token page", () => {
    const pages = walk(APP_DIR, "page.tsx")
      .map((file) => path.relative(APP_DIR, file).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("(app)/"));
    expect(pages.sort()).toEqual(["(auth)/login/page.tsx", "i/[token]/page.tsx", "privacy/page.tsx"]);
  });

  test("the public pages read no directory data", () => {
    const privacy = fs.readFileSync(path.join(APP_DIR, "privacy/page.tsx"), "utf8");
    expect(privacy).not.toMatch(/getDb|@\/server\//);
  });
});
