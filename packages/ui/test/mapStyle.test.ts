import { describe, it, expect } from "vitest";
import { brandMapStyle, MAP_PAINT, MAP_PLACES_LAYER } from "../src/mapStyle";
import { contrastRatio } from "../src/tokens";

const positron = () => ({
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
    { id: "water", type: "fill", paint: { "fill-color": "grey", "fill-antialias": true } },
    { id: "railway", type: "line", paint: { "line-color": "#ddd" } },
    { id: "label_other", type: "symbol", paint: { "text-color": "#333" } },
    { id: "label_city", type: "symbol", paint: { "text-color": "#000" } },
  ],
});

describe("brandMapStyle", () => {
  it("recolours the layers it names and keeps their other paint", () => {
    const out = brandMapStyle(positron());
    const water = out.layers.find((l) => l.id === "water")!;
    expect(water.paint).toEqual({ "fill-color": MAP_PAINT.water["fill-color"], "fill-antialias": true });
  });

  it("leaves layers it does not name alone", () => {
    const out = brandMapStyle(positron());
    expect(out.layers.find((l) => l.id === "railway")!.paint).toEqual({ "line-color": "#ddd" });
  });

  it("puts named places under the town names, so those win a collision", () => {
    const ids = brandMapStyle(positron()).layers.map((l) => l.id);
    expect(ids.indexOf(MAP_PLACES_LAYER.id)).toBe(ids.indexOf("label_other") - 1);
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
    expect(contrastRatio(MAP_PLACES_LAYER.paint["text-color"], ground)).toBeGreaterThanOrEqual(3);
  });
});
