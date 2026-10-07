import { assertEquals } from "jsr:@std/assert@1";
import { geoapify, google } from "./routers.ts";

const A = { lat: -1.9441, lng: 30.0619 };
const B = { lat: -1.9536, lng: 30.0925 };

/** Runs fn with fetch answering every request with this status and body. */
async function withFetch<T>(status: number, body: unknown, fn: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

const GEOAPIFY_OK = {
  features: [{
    properties: { distance: 4869.4, time: 457.6 },
    geometry: {
      type: "MultiLineString",
      coordinates: [[[30.061923456, -1.944112345], [30.07, -1.95], [30.0925, -1.9536]]],
    },
  }],
};

Deno.test("geoapify: a road comes back as metres, seconds and a lat-lng path", async () => {
  const { result } = await withFetch(200, GEOAPIFY_OK, () => geoapify("k", A, B));
  assertEquals(result, {
    distanceM: 4869,
    durationS: 458,
    path: [[-1.94411, 30.06192], [-1.95, 30.07], [-1.9536, 30.0925]],
  });
});

Deno.test("geoapify: asks for a drive between the two points, lat before lng", async () => {
  const { urls } = await withFetch(200, GEOAPIFY_OK, () => geoapify("k", A, B));
  assertEquals(urls.length, 1);
  const url = new URL(urls[0]);
  assertEquals(url.searchParams.get("waypoints"), "-1.9441,30.0619|-1.9536,30.0925");
  assertEquals(url.searchParams.get("mode"), "drive");
});

Deno.test("geoapify: an error or a reply without figures hands over to the next router", async () => {
  assertEquals((await withFetch(401, { message: "Invalid apiKey" }, () => geoapify("k", A, B))).result, null);
  assertEquals((await withFetch(200, { features: [] }, () => geoapify("k", A, B))).result, null);
});

Deno.test("google: a denied key hands over, no road at all is final", async () => {
  assertEquals((await withFetch(200, { status: "REQUEST_DENIED" }, () => google("k", A, B))).result, null);
  assertEquals((await withFetch(200, { status: "ZERO_RESULTS" }, () => google("k", A, B))).result, "no_route");
});

Deno.test("google: a route comes back with no shape", async () => {
  const ok = { status: "OK", routes: [{ legs: [{ distance: { value: 5012.4 }, duration: { value: 600.2 } }] }] };
  assertEquals((await withFetch(200, ok, () => google("k", A, B))).result, { distanceM: 5012, durationS: 600, path: [] });
});
