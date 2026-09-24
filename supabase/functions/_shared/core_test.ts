import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { quoteFare } from "./core.ts";
import type { FarePolicy } from "./core.ts";
import type {
  FarePolicy as RealFarePolicy,
  Receipt as RealReceipt,
  VehicleClass as RealVehicleClass,
} from "@gera/core";
import type {
  FarePolicy as BundleFarePolicy,
  Receipt as BundleReceipt,
  VehicleClass as BundleVehicleClass,
} from "./core.bundle.d.ts";

const MOTO: FarePolicy = {
  vehicleClass: "moto",
  baseRwf: 400,
  perKmRwf: 250,
  perMinuteRwf: 20,
  minimumRwf: 700,
  commissionPct: 15,
};

Deno.test("the bundle re-exports a working quoteFare", () => {
  assertEquals(quoteFare(MOTO, 4000, 720), 1700);
});

Deno.test("the bundle carries the generated-file header", async () => {
  const committed = await Deno.readTextFile(
    "supabase/functions/_shared/core.bundle.js",
  );
  assertMatch(committed, /^\/\/ GENERATED FILE - DO NOT EDIT\./);
});

// core.bundle.d.ts is hand-written (a generated .js bundle carries no type
// info of its own - see core.ts and core.bundle.d.ts for why it must stay
// self-contained rather than import packages/core's real types directly).
// These lines are the freshness guard for THAT file: if its shapes ever
// diverge from packages/core's real types, one of them fails to
// type-check - a TS2322 "Type 'true' is not assignable to type 'never'" -
// and `deno test`'s Check phase fails the whole file before any test runs.
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never)
  : never;
const _farePolicyTypesMatch: AssertSame<RealFarePolicy, BundleFarePolicy> =
  true;
const _vehicleClassTypesMatch: AssertSame<
  RealVehicleClass,
  BundleVehicleClass
> = true;
const _receiptTypesMatch: AssertSame<RealReceipt, BundleReceipt> = true;

Deno.test(
  "core.bundle.d.ts's hand-written types match packages/core's real types " +
    "(enforced above at typecheck time; a failure here means the AssertSame " +
    "lines were weakened, not that the types actually match)",
  () => {
    assertEquals(_farePolicyTypesMatch, true);
    assertEquals(_vehicleClassTypesMatch, true);
    assertEquals(_receiptTypesMatch, true);
  },
);

Deno.test(
  "core.bundle.js is fresh: it matches a rebuild from packages/core " +
    "(run `pnpm bundle:core` and commit the result if this fails)",
  async () => {
    // Runs the exact same recipe `pnpm bundle:core` uses (scripts/bundle-core.mjs),
    // but asks it to print to stdout instead of writing the real file, so this
    // test needs no write permission - only --allow-read (to read the committed
    // bundle below) and --allow-run (to spawn `node`, which itself spawns `deno
    // bundle`). Run from the repository root, same as `pnpm bundle:core` is.
    const rebuild = new Deno.Command("node", {
      args: ["scripts/bundle-core.mjs", "-"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await rebuild.output();
    if (code !== 0) {
      throw new Error(
        `scripts/bundle-core.mjs failed while checking freshness:\n${
          new TextDecoder().decode(stderr)
        }`,
      );
    }
    const fresh = new TextDecoder().decode(stdout);
    const committed = await Deno.readTextFile(
      "supabase/functions/_shared/core.bundle.js",
    );
    assertEquals(
      committed,
      fresh,
      "supabase/functions/_shared/core.bundle.js is stale relative to " +
        "packages/core - run `pnpm bundle:core` and commit the result",
    );
  },
);
