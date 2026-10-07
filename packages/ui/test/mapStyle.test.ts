import { describe, it, expect } from "vitest";
import { brandMapStyle, MAP_CASINGS, MAP_LAYOUT, MAP_PAINT, MAP_PLACES_LAYERS } from "../src/mapStyle";
import { contrastRatio } from "../src/tokens";

const minorWidth = ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.8, 20, 20];

const positron = () => ({
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
    { id: "water", type: "fill", paint: { "fill-color": "grey", "fill-antialias": true } },
    { id: "highway_minor", type: "line", filter: ["==", "class", "minor"], paint: { "line-color": "#ddd", "line-width": minorWidth } },
    { id: "railway", type: "line", paint: { "line-color": "#ddd" } },
    { id: "highway-name-minor", type: "symbol", layout: { "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#666" } },
    { id: "label_other", type: "symbol", paint: { "text-color": "#333" } },
    { id: "label_city", type: "symbol", paint: { "text-color": "#000" } },
  ],
});

const ids = () => brandMapStyle(positron()).layers.map((l) => l.id);

describe("brandMapStyle", () => {
  it("recolours the layers it names and keeps their other paint", () => {
    const water = brandMapStyle(positron()).layers.find((l) => l.id === "water")!;
    expect(water.paint).toEqual({ "fill-color": MAP_PAINT.water["fill-color"], "fill-antialias": true });
  });

  it("leaves layers it does not name alone", () => {
    expect(brandMapStyle(positron()).layers.find((l) => l.id === "railway")!.paint).toEqual({ "line-color": "#ddd" });
  });

  it("enlarges street names and keeps their font", () => {
    const names = brandMapStyle(positron()).layers.find((l) => l.id === "highway-name-minor")!;
    expect(names.layout).toEqual({ "text-font": ["Noto Sans Regular"], "text-size": MAP_LAYOUT["highway-name-minor"]["text-size"] });
  });

  it("draws an edge under side streets, as wide as the street, from the same filter", () => {
    const layers = brandMapStyle(positron()).layers;
    const edge = layers.find((l) => l.id === MAP_CASINGS[0].id)!;
    expect(ids().indexOf(MAP_CASINGS[0].id)).toBe(ids().indexOf("highway_minor") - 1);
    expect((edge.paint as Record<string, unknown>)["line-gap-width"]).toEqual(minorWidth);
    expect(edge.filter).toEqual(["==", "class", "minor"]);
  });

  it("puts named places under the town names, so those win a collision", () => {
    const order = ids();
    const places = MAP_PLACES_LAYERS.map((l) => order.indexOf(l.id));
    expect(places.every((i) => i >= 0 && i < order.indexOf("label_other"))).toBe(true);
    expect(order.indexOf("label_other") - 1).toBe(Math.max(...places));
  });

  it("does not change the style it was given", () => {
    const style = positron();
    const before = JSON.stringify(style);
    brandMapStyle(style);
    expect(JSON.stringify(style)).toBe(before);
  });

  it("keeps road and place names readable on the ground", () => {
    const ground = MAP_PAINT.background["background-color"];
    for (const id of ["highway-name-minor", "highway-name-major", "label_city", "label_town"] as const) {
      expect(contrastRatio(MAP_PAINT[id]["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(MAP_PLACES_LAYERS[0].paint["text-color"], ground)).toBeGreaterThanOrEqual(4.5);
  });
});
