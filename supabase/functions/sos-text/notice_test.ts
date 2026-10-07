import { assertEquals } from "jsr:@std/assert@1";
import { alertPhones, sosText } from "./notice.ts";

Deno.test("safety phones: local, international and spaced numbers all work; junk is dropped", () => {
  assertEquals(alertPhones("0790803794, +250 788 123 456,250722000111, 12345, "), [
    "+250790803794",
    "+250788123456",
    "+250722000111",
  ]);
  assertEquals(alertPhones(undefined), []);
});

Deno.test("the text says who, when, which trip, where, and their words", () => {
  const text = sosText({
    first_name: "Aline",
    source: "passenger",
    trip_id: "1a2e91bc-5bed-442c-8901-a58de133cd30",
    lng: 30.0619,
    lat: -1.9441,
    note: "He will not stop",
    created_at: "2026-10-07T11:30:00Z",
  });
  assertEquals(
    text,
    'NOVA SOS 13:30: Aline (passenger), trip NV-1A2E91. https://maps.google.com/?q=-1.94410,30.06190 "He will not stop". Open the control room.',
  );
  assertEquals(text.length <= 306, true);
});

Deno.test("a rider with no trip and no location still gets a useful text", () => {
  assertEquals(
    sosText({ first_name: null, source: "rider", trip_id: null, lng: null, lat: null, note: null, created_at: "2026-10-07T22:05:00Z" }),
    "NOVA SOS 00:05: Someone (rider), no trip. location not shared. Open the control room.",
  );
});
