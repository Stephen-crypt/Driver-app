import { describe, it, expect } from "vitest";
import { alongRoad, metresBetween, pathLengthM } from "../src/road";

// An L-shaped road in Kigali: about 1.1 km east, then about 1.1 km south.
const corner = { lat: -1.95, lng: 30.07 };
const road = [
  { lat: -1.95, lng: 30.06 },
  corner,
  { lat: -1.96, lng: 30.07 },
];

describe("metresBetween", () => {
  it("measures a hundredth of a degree of latitude as about 1.1 km", () => {
    expect(metresBetween({ lat: -1.95, lng: 30.07 }, { lat: -1.96, lng: 30.07 })).toBeCloseTo(1113, 0);
  });
});

describe("alongRoad", () => {
  it("at the start, all of the road is ahead", () => {
    const a = alongRoad(road, road[0]!);
    expect(a.offRoadM).toBeCloseTo(0, 3);
    expect(a.remainingM).toBeCloseTo(pathLengthM(road), 0);
  });

  it("halfway along the first leg, the road ahead starts there and keeps the corner", () => {
    const a = alongRoad(road, { lat: -1.95, lng: 30.065 });
    expect(a.remaining[0]!.lng).toBeCloseTo(30.065, 6);
    expect(a.remaining.slice(1)).toEqual([corner, road[2]]);
    expect(a.remainingM).toBeCloseTo(pathLengthM(road) * 0.75, -1);
  });

  it("a rider beside the road is snapped onto it, and how far off is reported", () => {
    // 0.001 degrees north of the first leg: about 111 m away.
    const a = alongRoad(road, { lat: -1.949, lng: 30.065 });
    expect(a.offRoadM).toBeCloseTo(111, 0);
    expect(a.remaining[0]!.lat).toBeCloseTo(-1.95, 6);
  });

  it("past the corner, only the second leg is left", () => {
    const a = alongRoad(road, { lat: -1.955, lng: 30.07 });
    expect(a.remaining).toHaveLength(2);
    expect(a.remainingM).toBeCloseTo(metresBetween({ lat: -1.955, lng: 30.07 }, road[2]!), 0);
  });

  it("at the end, nothing is left", () => {
    expect(alongRoad(road, road[2]!).remainingM).toBeCloseTo(0, 3);
  });

  it("copes with a road of one point or none", () => {
    expect(alongRoad([], corner).remaining).toEqual([]);
    expect(alongRoad([corner], corner).offRoadM).toBe(0);
  });
});
