import { assert, assertEquals } from "jsr:@std/assert@1";
import { inServiceArea, pricedRoute, straightLineM } from "./route.ts";

const KIMIRONKO = { lat: -1.9441, lng: 30.1127 };
const HEIGHTS = { lat: -1.9536, lng: 30.0588 };

Deno.test("a claimed 0 km ride is priced as at least the straight line", () => {
  const r = pricedRoute(KIMIRONKO, HEIGHTS, { distanceM: 0, durationS: 0 });
  assert(r.distanceM >= straightLineM(KIMIRONKO, HEIGHTS) * 1.2 - 1);
  assert(r.durationS > 0);
});

Deno.test("a real road distance longer than the floor is kept", () => {
  assertEquals(pricedRoute(KIMIRONKO, HEIGHTS, { distanceM: 9000, durationS: 1500 }), { distanceM: 9000, durationS: 1500 });
});

Deno.test("nonsense from the app is ignored, not trusted", () => {
  const r = pricedRoute(KIMIRONKO, HEIGHTS, { distanceM: "a lot", durationS: -5 });
  assert(r.distanceM > 5000);
});

Deno.test("Kigali is in the service area; Nairobi is not", () => {
  assert(inServiceArea(KIMIRONKO));
  assert(!inServiceArea({ lat: -1.2921, lng: 36.8219 }));
});
