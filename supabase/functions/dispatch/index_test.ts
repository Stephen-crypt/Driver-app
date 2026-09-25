import { assertEquals } from "jsr:@std/assert@1";
import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import { isDispatchable, selectBestCandidate } from "./logic.ts";

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

// The dispatcher's own logic: what state a trip must be in, and which
// candidate wins. These are the paths findings 1 and 2 lived in unverified.

Deno.test("isDispatchable accepts a fresh request and a re-dispatch", () => {
  assertEquals(isDispatchable("requested"), true);
  assertEquals(isDispatchable("offered"), true);
});

Deno.test("isDispatchable rejects trips no longer open to (re)dispatch", () => {
  for (const state of ["accepted", "in_progress", "completed", "cancelled_by_rider"]) {
    assertEquals(isDispatchable(state), false, `${state} must not be dispatchable`);
  }
});

Deno.test("selectBestCandidate returns null when there is nobody to rank", async () => {
  const best = await selectBestCandidate([], "moto", straightLineEta);
  assertEquals(best, null);
});

Deno.test("selectBestCandidate picks the lowest ETA, not the first row", async () => {
  const best = await selectBestCandidate(
    [
      { driver_id: "far", distance_m: 3800 },
      { driver_id: "near", distance_m: 400 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(best?.driverId, "near");
});

Deno.test("selectBestCandidate handles a single candidate", async () => {
  const best = await selectBestCandidate(
    [{ driver_id: "only", distance_m: 900 }],
    "moto",
    straightLineEta,
  );
  assertEquals(best?.driverId, "only");
  assertEquals(typeof best?.etaSeconds, "number");
});
