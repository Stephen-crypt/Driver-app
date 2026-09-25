import { assertEquals } from "jsr:@std/assert@1";
import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";

Deno.test("the shortlist bounds how many ETA lookups dispatch will pay for", () => {
  assertEquals(CANDIDATE_SHORTLIST, 5);
});

Deno.test("the search widens rather than starting wide", () => {
  assertEquals([...DISPATCH_RADII_M], [1000, 2000, 4000]);
});

Deno.test("an offer is exclusive for fifteen seconds", () => {
  assertEquals(OFFER_TTL_SECONDS, 15);
});

Deno.test("the nearest driver is offered first", async () => {
  const ranked = await rankByEta(
    [
      { driverId: "far", distanceM: 3800 },
      { driverId: "near", distanceM: 400 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked[0]?.driverId, "near");
});
