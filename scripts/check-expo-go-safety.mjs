// Guards against a class of bug that bundles cleanly and then dies on launch.
//
// Some Expo modules throw the moment they are IMPORTED under Expo Go rather
// than when they are called. expo-notifications is the live example: SDK 53
// removed Android remote push from Expo Go, and a top-level
//
//   import * as Notifications from "expo-notifications"
//
// threw before any of our code ran. The screen that imported it produced no
// default export, and the app died on an ErrorBoundary with a push error as the
// only clue. A runtime guard inside the function could not help - the import
// had already thrown.
//
// `expo export` does not catch this: bundling never executes module top-level
// code. Neither does tsc. So it is checked here, by reading the source.
//
// The fix in every case is to require() the module lazily, behind a check that
// the environment can actually support it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** Modules that throw on import under Expo Go, not on first use. */
const UNSAFE_TO_IMPORT = ["expo-notifications"];

const ROOTS = ["apps/passenger", "apps/rider"];

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".expo" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const problems = [];

for (const base of ROOTS) {
  for (const file of sourceFiles(join(ROOT, base))) {
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);

    lines.forEach((line, i) => {
      // A type-only import emits nothing at runtime, so it is safe. So is a
      // require(), which is the fix we want people to use.
      const isTypeOnly = /^\s*import\s+type\b/.test(line) || /typeof\s+import\(/.test(line);
      if (isTypeOnly) return;

      for (const mod of UNSAFE_TO_IMPORT) {
        const importsIt =
          new RegExp(`^\\s*import\\s[^;]*from\\s+["']${mod}["']`).test(line) ||
          new RegExp(`^\\s*import\\s+["']${mod}["']`).test(line);
        if (importsIt) {
          problems.push({
            file: relative(ROOT, file),
            line: i + 1,
            mod,
            text: line.trim(),
          });
        }
      }
    });
  }
}

if (problems.length > 0) {
  console.error("\nExpo Go safety check FAILED\n");
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`);
    console.error(`    ${p.text}`);
    console.error(
      `    ${p.mod} throws on import under Expo Go. Load it with require() inside\n` +
        `    the function that needs it, behind an executionEnvironment check.\n`,
    );
  }
  process.exit(1);
}

console.log(`Expo Go safety: ok (${UNSAFE_TO_IMPORT.join(", ")} not imported at module scope)`);
