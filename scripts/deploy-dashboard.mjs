// Builds the staff dashboard against the live project and publishes it to
// Vercel as a static site.
//
//   pnpm deploy:dashboard
//
// The build runs here, with the live Supabase URL and anon key from
// apps/dashboard/.env.live.local (git-ignored), so Vercel never has to build
// this monorepo and holds no settings of its own. The anon key is public by
// design: what staff can see and do is decided by the database.
//
// Vercel routing and headers come from apps/dashboard/public/vercel.json,
// which Vite copies into dist. The project is "nova-control"; the first run
// creates it. Needs `vercel login` once on this machine.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dashboard = path.join(root, "apps", "dashboard");
const dist = path.join(dashboard, "dist");
const PROJECT = process.env.VERCEL_PROJECT ?? "nova-control";
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

if (!existsSync(path.join(dashboard, ".env.live.local"))) {
  console.error("apps/dashboard/.env.live.local is missing: it holds the live Supabase URL and anon key.");
  process.exit(1);
}

run("pnpm --filter dashboard exec tsc --noEmit");
run("pnpm --filter dashboard exec vite build --mode live");
// dist is emptied by every build, so the link to the Vercel project is made again each time.
run(`vercel link --yes --project ${PROJECT}`, dist);
run("vercel deploy --prod --yes", dist);
