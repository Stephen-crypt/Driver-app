// GENERATED FILE - DO NOT EDIT.
// Built from packages/core/src/index.ts by `pnpm bundle:core`.
// packages/core is the only place fare and commission arithmetic is authored.
// packages/core/src/trip/states.ts
var TRIP_STATES = [
  "requested",
  "offered",
  "accepted",
  "arrived",
  "in_progress",
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers"
];
var ACTORS = [
  "rider",
  "driver",
  "system"
];
var TERMINAL_STATES = [
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "expired",
  "no_drivers"
];
function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

// packages/core/src/trip/transitions.ts
var TRANSITIONS = [
  {
    from: "requested",
    to: "offered",
    actors: [
      "system"
    ]
  },
  {
    from: "requested",
    to: "no_drivers",
    actors: [
      "system"
    ]
  },
  {
    from: "requested",
    to: "cancelled_by_rider",
    actors: [
      "rider"
    ]
  },
  // A declined or timed-out offer re-enters `offered` for the next candidate.
  {
    from: "offered",
    to: "offered",
    actors: [
      "system"
    ]
  },
  {
    from: "offered",
    to: "accepted",
    actors: [
      "driver"
    ]
  },
  {
    from: "offered",
    to: "expired",
    actors: [
      "system"
    ]
  },
  {
    from: "offered",
    to: "no_drivers",
    actors: [
      "system"
    ]
  },
  {
    from: "offered",
    to: "cancelled_by_rider",
    actors: [
      "rider"
    ]
  },
  {
    from: "accepted",
    to: "arrived",
    actors: [
      "driver"
    ]
  },
  {
    from: "accepted",
    to: "cancelled_by_rider",
    actors: [
      "rider"
    ]
  },
  {
    from: "accepted",
    to: "cancelled_by_driver",
    actors: [
      "driver"
    ]
  },
  // Heartbeat loss re-dispatches a trip that never reached pickup.
  {
    from: "accepted",
    to: "offered",
    actors: [
      "system"
    ]
  },
  {
    from: "arrived",
    to: "in_progress",
    actors: [
      "driver"
    ]
  },
  {
    from: "arrived",
    to: "cancelled_by_rider",
    actors: [
      "rider"
    ]
  },
  {
    from: "arrived",
    to: "cancelled_by_driver",
    actors: [
      "driver"
    ]
  },
  {
    from: "in_progress",
    to: "completed",
    actors: [
      "driver"
    ]
  }
];

// packages/core/src/trip/machine.ts
function canTransition(from, to, actor) {
  if (isTerminal(from)) return false;
  return TRANSITIONS.some((rule) => rule.from === from && rule.to === to && rule.actors.includes(actor));
}
function applyTransition(from, to, actor) {
  if (isTerminal(from)) return {
    ok: false,
    reason: "terminal"
  };
  const edge = TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
  if (!edge) return {
    ok: false,
    reason: "illegal_edge"
  };
  if (!edge.actors.includes(actor)) return {
    ok: false,
    reason: "wrong_actor"
  };
  return {
    ok: true,
    state: to
  };
}

// packages/core/src/fare/policy.ts
var VEHICLE_CLASSES = [
  "moto",
  "cab",
  "cab_xl"
];
function roundFareRwf(amount) {
  return Math.ceil(amount / 100) * 100;
}

// packages/core/src/fare/quote.ts
function quoteFare(policy, distanceMetres, durationSeconds) {
  if (distanceMetres < 0) throw new Error("distanceMetres must be >= 0");
  if (durationSeconds < 0) throw new Error("durationSeconds must be >= 0");
  const distanceCharge = distanceMetres / 1e3 * policy.perKmRwf;
  const timeCharge = durationSeconds / 60 * policy.perMinuteRwf;
  const raw = policy.baseRwf + distanceCharge + timeCharge;
  return roundFareRwf(Math.max(raw, policy.minimumRwf));
}

// packages/core/src/fare/finalize.ts
var OVERAGE_TOLERANCE = 0.15;
function finalizeFare(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres) {
  if (actualDistanceMetres < 0) throw new Error("actualDistanceMetres must be >= 0");
  const bandEnd = quotedDistanceMetres * (1 + OVERAGE_TOLERANCE);
  const overageMetres = Math.max(0, Math.round(actualDistanceMetres - bandEnd));
  const overageRwf = overageMetres === 0 ? 0 : Math.ceil(overageMetres * policy.perKmRwf / 1e5) * 100;
  return {
    totalRwf: quotedRwf + overageRwf,
    quotedRwf,
    overageRwf,
    overageMetres
  };
}

// packages/core/src/ledger/commission.ts
var LEDGER_ENTRY_KINDS = [
  "commission_debit",
  "topup_credit",
  "adjustment_credit",
  "adjustment_debit"
];
function isCredit(kind) {
  switch (kind) {
    case "topup_credit":
    case "adjustment_credit":
      return true;
    case "commission_debit":
    case "adjustment_debit":
      return false;
    default: {
      const unhandled = kind;
      throw new Error(`unhandled ledger entry kind: ${String(unhandled)}`);
    }
  }
}
function commissionFor(fareRwf, ratePercent) {
  if (ratePercent < 0 || ratePercent > 100) {
    throw new Error("ratePercent must be between 0 and 100");
  }
  return Math.round(fareRwf * ratePercent / 100);
}
function balanceOf(entries) {
  return entries.reduce((total, entry) => {
    if (entry.amountRwf < 0) throw new Error("amountRwf must be >= 0");
    return isCredit(entry.kind) ? total + entry.amountRwf : total - entry.amountRwf;
  }, 0);
}
function canGoOnline(balanceRwf, minimumRwf) {
  return balanceRwf >= minimumRwf;
}

// packages/core/src/fare/receipt.ts
function buildReceipt(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres) {
  const final = finalizeFare(policy, quotedRwf, quotedDistanceMetres, actualDistanceMetres);
  const lines = [
    {
      label: "Fare",
      amountRwf: final.quotedRwf
    }
  ];
  if (final.overageRwf > 0) {
    lines.push({
      label: "Extra distance",
      amountRwf: final.overageRwf
    });
  }
  return {
    lines,
    totalRwf: final.totalRwf,
    commissionRwf: commissionFor(final.totalRwf, policy.commissionPct)
  };
}
export {
  ACTORS,
  LEDGER_ENTRY_KINDS,
  OVERAGE_TOLERANCE,
  TERMINAL_STATES,
  TRANSITIONS,
  TRIP_STATES,
  VEHICLE_CLASSES,
  applyTransition,
  balanceOf,
  buildReceipt,
  canGoOnline,
  canTransition,
  commissionFor,
  finalizeFare,
  isTerminal,
  quoteFare,
  roundFareRwf
};
