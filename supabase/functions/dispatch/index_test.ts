import { assertEquals } from "jsr:@std/assert@1";
import {
  rankByEta,
  straightLineEta,
  DISPATCH_RADII_M,
  CANDIDATE_SHORTLIST,
  OFFER_TTL_SECONDS,
} from "../_shared/core.ts";
import { isDispatchable, rankCandidates } from "./logic.ts";

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

Deno.test("rankCandidates returns an empty list when there is nobody to rank", async () => {
  const ranked = await rankCandidates([], "moto", straightLineEta);
  assertEquals(ranked, []);
});

Deno.test("rankCandidates puts the lowest ETA first, not the first row", async () => {
  const ranked = await rankCandidates(
    [
      { driver_id: "far", distance_m: 3800 },
      { driver_id: "near", distance_m: 400 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked[0]?.driverId, "near");
});

Deno.test("rankCandidates handles a single candidate", async () => {
  const ranked = await rankCandidates(
    [{ driver_id: "only", distance_m: 900 }],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked.length, 1);
  assertEquals(ranked[0]?.driverId, "only");
  assertEquals(typeof ranked[0]?.etaSeconds, "number");
});

// Finding 4: the head alone was not enough. When create_trip_offer refuses the
// best candidate - the driver took another trip between the candidate search
// and the insert - the dispatcher has to have somebody else to ask, or the trip
// sits in `requested` with no offer and nothing scheduled to retry it. That is
// only possible if the ranking yields the whole list.
Deno.test("rankCandidates yields the whole shortlist, in ETA order", async () => {
  const ranked = await rankCandidates(
    [
      { driver_id: "third", distance_m: 3000 },
      { driver_id: "first", distance_m: 200 },
      { driver_id: "second", distance_m: 1500 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked.map((c) => c.driverId), ["first", "second", "third"]);
});

// The fallback is only useful if every entry carries what create_trip_offer
// needs: a refusal of the head must be followed by a complete second attempt,
// not one missing its eta_seconds.
Deno.test("every ranked candidate carries an ETA, not just the head", async () => {
  const ranked = await rankCandidates(
    [
      { driver_id: "a", distance_m: 200 },
      { driver_id: "b", distance_m: 1500 },
      { driver_id: "c", distance_m: 3000 },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked.length, 3);
  for (const c of ranked) {
    assertEquals(typeof c.etaSeconds, "number", `${c.driverId} has no ETA`);
  }
  // Strictly increasing, so "next best" is a real ordering and not an accident
  // of the input order.
  assertEquals(ranked[0].etaSeconds < ranked[1].etaSeconds, true);
  assertEquals(ranked[1].etaSeconds < ranked[2].etaSeconds, true);
});

// distance_m arrives from PostgREST as a JSON number, but a numeric-typed
// column can arrive as a string. rankCandidates coerces; a string that survived
// coercion would sort lexically and hand the shortlist back in the wrong order.
Deno.test("rankCandidates coerces distances before ranking them", async () => {
  const ranked = await rankCandidates(
    [
      { driver_id: "nine-hundred", distance_m: "900" as unknown as number },
      { driver_id: "one-thousand-one-hundred", distance_m: "1100" as unknown as number },
    ],
    "moto",
    straightLineEta,
  );
  assertEquals(ranked.map((c) => c.driverId), ["nine-hundred", "one-thousand-one-hundred"]);
});
