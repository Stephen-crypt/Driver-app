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
  "cancelled_by_passenger",
  "cancelled_by_rider",
  "expired",
  "no_riders"
];
var ACTORS = [
  "passenger",
  "rider",
  "system"
];
var TERMINAL_STATES = [
  "completed",
  "cancelled_by_passenger",
  "cancelled_by_rider",
  "expired",
  "no_riders"
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
    to: "no_riders",
    actors: [
      "system"
    ]
  },
  {
    from: "requested",
    to: "cancelled_by_passenger",
    actors: [
      "passenger"
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
      "rider"
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
    to: "no_riders",
    actors: [
      "system"
    ]
  },
  {
    from: "offered",
    to: "cancelled_by_passenger",
    actors: [
      "passenger"
    ]
  },
  {
    from: "accepted",
    to: "arrived",
    actors: [
      "rider"
    ]
  },
  {
    from: "accepted",
    to: "cancelled_by_passenger",
    actors: [
      "passenger"
    ]
  },
  {
    from: "accepted",
    to: "cancelled_by_rider",
    actors: [
      "rider"
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
      "rider"
    ]
  },
  {
    from: "arrived",
    to: "cancelled_by_passenger",
    actors: [
      "passenger"
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
    from: "in_progress",
    to: "completed",
    actors: [
      "rider"
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

// packages/core/src/ledger/entries.ts
var LEDGER_ENTRY_KINDS = [
  // Cash side.
  "fare_collected",
  "cash_remittance",
  // Earnings side.
  "trip_earning",
  "bonus",
  "deduction",
  "payout",
  "adjustment_credit",
  "adjustment_debit",
  // Retired marketplace kinds. Postgres cannot drop an enum value and the rows
  // already written are real history, so they stay - classified, never written.
  "commission_debit",
  "topup_credit"
];
function classify(kind) {
  switch (kind) {
    case "fare_collected":
      return {
        side: "cash",
        sign: 1
      };
    case "cash_remittance":
      return {
        side: "cash",
        sign: -1
      };
    case "trip_earning":
    case "bonus":
    case "adjustment_credit":
    // A top-up was money the rider had already handed the company, so under
    // the fleet reading it counts the same way: something we owe them back.
    case "topup_credit":
      return {
        side: "owed",
        sign: 1
      };
    case "deduction":
    case "payout":
    case "adjustment_debit":
    // Commission reduced what a marketplace rider was owed.
    case "commission_debit":
      return {
        side: "owed",
        sign: -1
      };
    default: {
      const unhandled = kind;
      throw new Error(`unhandled ledger entry kind: ${String(unhandled)}`);
    }
  }
}
function total(entries, side) {
  return entries.reduce((sum, entry) => {
    if (entry.amountRwf < 0) throw new Error("amountRwf must be >= 0");
    const { side: entrySide, sign } = classify(entry.kind);
    return entrySide === side ? sum + sign * entry.amountRwf : sum;
  }, 0);
}
function cashHeldOf(entries) {
  return total(entries, "cash");
}
function netOwedOf(entries) {
  return total(entries, "owed");
}
function commissionFor(fareRwf, ratePercent) {
  if (ratePercent < 0 || ratePercent > 100) {
    throw new Error("ratePercent must be between 0 and 100");
  }
  return Math.round(fareRwf * ratePercent / 100);
}
function riderEarningFor(fareRwf, commissionPercent) {
  return fareRwf - commissionFor(fareRwf, commissionPercent);
}
function canGoOnline(args) {
  return args.hasActiveVehicle && args.cashHeldRwf <= args.maxCashHeldRwf;
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
    commissionRwf: commissionFor(final.totalRwf, policy.commissionPct),
    riderEarningRwf: riderEarningFor(final.totalRwf, policy.commissionPct)
  };
}

// packages/core/src/dispatch/eta.ts
var OFFER_TTL_SECONDS = 15;
var DISPATCH_RADII_M = [
  1e3,
  2e3,
  4e3
];
var CANDIDATE_SHORTLIST = 5;
var AVERAGE_SPEED_MPS = {
  moto: 7.5,
  cab: 5.5,
  cab_xl: 5
};
var straightLineEta = {
  estimate(distanceMetres, vehicleClass) {
    if (distanceMetres < 0) {
      return Promise.reject(new Error("distanceMetres must be >= 0"));
    }
    return Promise.resolve(Math.round(distanceMetres / AVERAGE_SPEED_MPS[vehicleClass]));
  }
};
async function rankByEta(candidates, vehicleClass, provider) {
  const withEta = await Promise.all(candidates.map(async (c) => ({
    ...c,
    etaSeconds: await provider.estimate(c.distanceM, vehicleClass)
  })));
  return withEta.sort((a, b) => a.etaSeconds - b.etaSeconds);
}
export {
  ACTORS,
  AVERAGE_SPEED_MPS,
  CANDIDATE_SHORTLIST,
  DISPATCH_RADII_M,
  LEDGER_ENTRY_KINDS,
  OFFER_TTL_SECONDS,
  OVERAGE_TOLERANCE,
  TERMINAL_STATES,
  TRANSITIONS,
  TRIP_STATES,
  VEHICLE_CLASSES,
  applyTransition,
  buildReceipt,
  canGoOnline,
  canTransition,
  cashHeldOf,
  commissionFor,
  finalizeFare,
  isTerminal,
  netOwedOf,
  quoteFare,
  rankByEta,
  riderEarningFor,
  roundFareRwf,
  straightLineEta
};
