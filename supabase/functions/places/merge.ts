// One result list from two sources: Geoapify (OpenStreetMap - places, streets
// and areas) and open_places (Overture - the businesses OSM lacks). A close
// name match from Overture leads, because when someone types a cafe's name
// that cafe is what they want; Geoapify follows; weaker Overture matches
// fill the rest. The same place from both, a few hundred metres apart under
// one name, shows once.
import type { Found } from "./geoapify.ts";

export interface OpenPlace {
  id: string;
  name: string;
  category: string | null;
  street: string | null;
  lng: number;
  lat: number;
  score: number;
}

const STRONG = 0.5;
const LIMIT = 10;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** "coffee_shop" -> "Coffee shop": a second line when Overture has no street. */
function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  const words = category.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toFound(p: OpenPlace): Found {
  return { id: `o:${p.id}`, name: p.name, detail: p.street ?? categoryLabel(p.category), lat: p.lat, lng: p.lng };
}

export function mergePlaces(geo: Found[], open: OpenPlace[]): Found[] {
  const out: Found[] = [];
  const add = (f: Found) => {
    const twin = out.some((o) => o.name.toLowerCase() === f.name.toLowerCase() && metres(o, f) < 400);
    if (!twin && out.length < LIMIT) out.push(f);
  };
  open.filter((p) => p.score >= STRONG).forEach((p) => add(toFound(p)));
  geo.forEach(add);
  open.filter((p) => p.score < STRONG).forEach((p) => add(toFound(p)));
  return out;
}
