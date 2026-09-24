import { TRANSITIONS } from "../src/trip/transitions";

for (const rule of TRANSITIONS) {
  for (const actor of rule.actors) {
    console.log(`${rule.from},${rule.to},${actor}`);
  }
}
