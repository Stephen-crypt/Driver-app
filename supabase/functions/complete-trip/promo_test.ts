import { assertEquals } from "jsr:@std/assert@1";
import { withPromo } from "./promo.ts";

const RECEIPT = { lines: [{ label: "Fare", amountRwf: 1800 }], totalRwf: 1800 };

Deno.test("a promo: the total is what the rider collects, so older rider apps ask for the right cash", () => {
  assertEquals(withPromo(RECEIPT, 500), {
    lines: [{ label: "Fare", amountRwf: 1800 }, { label: "Promo", amountRwf: -500 }],
    totalRwf: 1300,
    grossRwf: 1800,
    promoRwf: 500,
    paidRwf: 1300,
  });
});

Deno.test("no promo: nothing changes", () => {
  assertEquals(withPromo(RECEIPT, 0), { ...RECEIPT, grossRwf: 1800, promoRwf: 0, paidRwf: 1800 });
});
