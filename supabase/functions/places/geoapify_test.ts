import { assertEquals } from "jsr:@std/assert@1";
import { normaliseQuery, parseReverse, parseSearch, reverseUrl, searchUrl } from "./geoapify.ts";

Deno.test("coded streets are spelled out the way OpenStreetMap names them", () => {
  assertEquals(normaliseQuery("kg7 ave"), { text: "KG 7 Avenue", street: true });
  assertEquals(normaliseQuery("KN 5 rd"), { text: "KN 5 Road", street: true });
  assertEquals(normaliseQuery("kk 19 St."), { text: "KK 19 Street", street: true });
  assertEquals(normaliseQuery("  Kigali   Heights "), { text: "Kigali Heights", street: false });
});

Deno.test("search stays inside Kigali and leans towards the passenger", () => {
  const url = new URL(searchUrl("k", "serena", { lat: -1.95, lng: 30.09 }));
  assertEquals(url.searchParams.get("text"), "serena");
  assertEquals(url.searchParams.get("filter"), "circle:30.0619,-1.9441,35000");
  assertEquals(url.searchParams.get("bias"), "proximity:30.09,-1.95");
  assertEquals(url.searchParams.get("type"), null);
  assertEquals(new URL(searchUrl("k", "kn 5 rd", null)).searchParams.get("type"), "street");
});

Deno.test("search keeps named places and streets, drops house numbers and provinces", () => {
  const found = parseSearch({
    results: [
      // Someone typed the market's name into a house number in Kiyovu.
      { place_id: "a", result_type: "building", address_line1: "kimironko market KN 1 Avenue", lat: -1.9459, lon: 30.0714 },
      { place_id: "b", name: "Kimironko Market", result_type: "amenity", address_line1: "Kimironko Market", address_line2: "KG 161 Street, City of Kigali, Rwanda", lat: -1.94977, lon: 30.12629 },
      { place_id: "c", result_type: "state", address_line1: "Eastern Province", address_line2: "Rwanda", lat: -1.7, lon: 30.3 },
      { place_id: "d", result_type: "street", address_line1: "KN 5 Road", address_line2: "City of Kigali, Rwanda", lat: -1.95, lon: 30.09 },
    ],
  });
  assertEquals(found, [
    { id: "b", name: "Kimironko Market", detail: "KG 161 Street, Kigali", lat: -1.94977, lng: 30.12629 },
    { id: "d", name: "KN 5 Road", detail: "Kigali", lat: -1.95, lng: 30.09 },
  ]);
});

Deno.test("the same place mapped twice shows once; far-apart namesakes both show", () => {
  const found = parseSearch({
    results: [
      { place_id: "1", name: "Kigali Heights", result_type: "amenity", address_line1: "Kigali Heights", address_line2: "KN 5 Rd, Kimihurura, Rwanda", lat: -1.9536, lon: 30.0925 },
      { place_id: "2", name: "Kigali Heights", result_type: "amenity", address_line1: "Kigali Heights", address_line2: "KG 7 Avenue, Kigali, Rwanda", lat: -1.9530, lon: 30.0929 },
      { place_id: "3", name: "Kigali Heights", result_type: "amenity", address_line1: "Kigali Heights", address_line2: "KG 541 Street, Rwanda", lat: -1.9800, lon: 30.1300 },
    ],
  });
  assertEquals(found.map((f) => f.id), ["1", "3"]);
});

Deno.test("search survives an empty or broken reply", () => {
  assertEquals(parseSearch(null), []);
  assertEquals(parseSearch({}), []);
  assertEquals(parseSearch({ results: [{ name: "No position" }] }), []);
});

Deno.test("reverse asks for the point, lat and lon", () => {
  const url = new URL(reverseUrl("k", { lat: -1.9393, lng: 30.0446 }));
  assertEquals([url.searchParams.get("lat"), url.searchParams.get("lon")], ["-1.9393", "30.0446"]);
});

Deno.test("where am I: a named place beside you, else the street and area", () => {
  const near = { name: "RITCO", street: "KN 7 Road", suburb: "Kimisagara", result_type: "amenity", distance: 94 };
  assertEquals(parseReverse({ results: [near] }), "Near RITCO");
  // A named place a street away is not where you are standing.
  assertEquals(parseReverse({ results: [{ ...near, distance: 400 }] }), "KN 7 Road, Kimisagara");
  assertEquals(
    parseReverse({ results: [{ name: "KG 45 Street", street: "KG 45 Street", suburb: "Kibagabaga", result_type: "street", distance: 2 }] }),
    "KG 45 Street, Kibagabaga",
  );
  assertEquals(parseReverse({ results: [{ street: "KN 5 Rd", district: "Gasabo District", result_type: "street" }] }), "KN 5 Rd, Gasabo");
  assertEquals(parseReverse({ results: [] }), null);
});
