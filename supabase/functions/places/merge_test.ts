import { assertEquals } from "jsr:@std/assert@1";
import { mergePlaces, type OpenPlace } from "./merge.ts";
import type { Found } from "./geoapify.ts";

const geo: Found[] = [
  { id: "g1", name: "Kigali Heights", detail: "KN 5 Rd, Kimihurura", lat: -1.9536, lng: 30.0925 },
  { id: "g2", name: "KG 7 Avenue", detail: "Kigali", lat: -1.95, lng: 30.09 },
];
const open = (name: string, score: number, extra: Partial<OpenPlace> = {}): OpenPlace => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  category: "coffee_shop",
  street: null,
  lat: -1.95,
  lng: 30.1,
  score,
  ...extra,
});

Deno.test("a close Overture match leads, then Geoapify, then weaker matches", () => {
  const out = mergePlaces(geo, [open("Question Coffee", 0.9), open("Questionable Shop", 0.3)]);
  assertEquals(out.map((f) => f.name), ["Question Coffee", "Kigali Heights", "KG 7 Avenue", "Questionable Shop"]);
});

Deno.test("Overture rows carry their own id space and a readable second line", () => {
  const [f] = mergePlaces([], [open("Inzora Rooftop Cafe", 1, { category: "coffee_shop" })]);
  assertEquals(f.id, "o:inzora-rooftop-cafe");
  assertEquals(f.detail, "Coffee shop");
  assertEquals(mergePlaces([], [open("Deco Center MIC", 0.8, { street: "KK 15 Rd" })])[0].detail, "KK 15 Rd");
});

Deno.test("the same place from both sources shows once", () => {
  const out = mergePlaces(geo, [open("Kigali Heights", 0.95, { lat: -1.9534, lng: 30.0923 })]);
  assertEquals(out.filter((f) => f.name === "Kigali Heights").length, 1);
});

Deno.test("no more than ten rows", () => {
  const many = Array.from({ length: 15 }, (_, i) => open(`Cafe ${i}`, 0.9, { lat: -1.9 - i / 100 }));
  assertEquals(mergePlaces(geo, many).length, 10);
});
