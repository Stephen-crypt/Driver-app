// Applies the NOVA vocabulary swap to source, tests and scripts.
//
// Same placeholder swap as the database migration, for the same reason: rider
// and driver trade places, so a sequential replace turns every driver into a
// passenger. Run once, then let the test suites prove it.
//
//   node scripts/rename-code-nova.mjs --dry     list what would change
//   node scripts/rename-code-nova.mjs           write it
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DRY = process.argv.includes("--dry");

const ROOTS = ["supabase/tests", "supabase/functions", "packages", "apps", "scripts", "docs/operations"];
const EXTS = new Set([".ts", ".tsx", ".sql", ".mjs", ".js", ".json", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "assets", ".git"]);

// Files that describe the rename itself, or record history, must not be swapped
// - rewriting them would erase the before side of every example.
const SKIP_FILES = new Set([
  "supabase/functions/_shared/core.bundle.js",
  "scripts/gen-nova-rename.mjs",
  "scripts/rename-code-nova.mjs",
  "docs/nova-gap-analysis.md",
]);

function swap(text) {
  return text
    // The Docker container is named after the checkout directory, not after any
    // role. The swap has no business touching it.
    .replace(/supabase_db_driver_app/g, "c")
    .replace(/driving_licence/g, "\u0001a\u0001")
    .replace(/drivingLicence/g, "\u0001b\u0001")
    .replace(/rider/g, "\u0002a\u0002")
    .replace(/Rider/g, "\u0002b\u0002")
    .replace(/RIDER/g, "\u0002c\u0002")
    .replace(/driver/g, "rider")
    .replace(/Driver/g, "Rider")
    .replace(/DRIVER/g, "RIDER")
    .replace(/\u0002a\u0002/g, "passenger")
    .replace(/\u0002b\u0002/g, "Passenger")
    .replace(/\u0002c\u0002/g, "PASSENGER")
    .replace(/\u0001a\u0001/g, "driving_licence")
    .replace(/\u0001b\u0001/g, "drivingLicence");
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(entry))) yield full;
  }
}

let changed = 0;
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    scanned++;

    const before = readFileSync(file, "utf8");
    const after = swap(before);
    if (before === after) continue;

    changed++;
    if (DRY) {
      const hits = (before.match(/rider|driver|Rider|Driver/g) ?? []).length;
      console.log(`  ${rel}  (${hits} occurrences)`);
    } else {
      writeFileSync(file, after);
    }
  }
}

console.log(
  DRY
    ? `\n${changed} of ${scanned} files would change. Re-run without --dry to write.`
    : `\n${changed} of ${scanned} files rewritten.`,
);
