import { isTerminal, type Actor, type TripState } from "./states";
import { TRANSITIONS } from "./transitions";

export { TRANSITIONS };
export type { TransitionRule } from "./transitions";

export type TransitionResult =
  | { ok: true; state: TripState }
  | { ok: false; reason: "illegal_edge" | "wrong_actor" | "terminal" };

export function canTransition(from: TripState, to: TripState, actor: Actor): boolean {
  if (isTerminal(from)) return false;
  return TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.actors.includes(actor),
  );
}

export function applyTransition(
  from: TripState,
  to: TripState,
  actor: Actor,
): TransitionResult {
  if (isTerminal(from)) return { ok: false, reason: "terminal" };

  const edge = TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
  if (!edge) return { ok: false, reason: "illegal_edge" };
  if (!edge.actors.includes(actor)) return { ok: false, reason: "wrong_actor" };

  return { ok: true, state: to };
}
