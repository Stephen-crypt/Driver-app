#!/usr/bin/env node
// Regenerates supabase/functions/_shared/core.bundle.js from packages/core.
//
// `supabase functions serve` only bind-mounts the `supabase/functions`
// directory into its edge-runtime container, so `packages/core` (a sibling
// of `supabase/`) is invisible at runtime there even though the import map
// resolves it correctly on the host. This script is the ONLY place
// packages/core is compiled into something the container can see.
// supabase/functions/_shared/core_test.ts re-runs this exact command and
// fails if the committed bundle has drifted from packages/core.
//
// Usage:
//   node scripts/bundle-core.mjs      writes supabase/functions/_shared/core.bundle.js
//   node scripts/bundle-core.mjs -    prints the bundle to stdout instead (used by the freshness test)
//
// Run from the repository root (this is how `pnpm bundle:core` and the
// freshness test both invoke it).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT_PATH = "supabase/functions/_shared/core.bundle.js";
const HEADER =
  "// GENERATED FILE - DO NOT EDIT.\n" +
  "// Built from packages/core/src/index.ts by `pnpm bundle:core`.\n" +
  "// packages/core is the only place fare and commission arithmetic is authored.\n";

const bundled = execFileSync(
  "deno",
  ["bundle", "--unstable-sloppy-imports", "packages/core/src/index.ts"],
  { encoding: "utf8" },
);

const content = HEADER + bundled;

if (process.argv[2] === "-") {
  process.stdout.write(content);
} else {
  writeFileSync(OUT_PATH, content);
  console.log(`wrote ${OUT_PATH}`);
}
