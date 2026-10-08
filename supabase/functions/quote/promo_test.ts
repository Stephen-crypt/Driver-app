import { assertEquals } from "jsr:@std/assert@1";
import { promoChoice } from "./promo.ts";

Deno.test("no choice means the best saved code", () => {
  assertEquals(promoChoice(undefined), "best");
});

Deno.test("none and best pass through", () => {
  assertEquals(promoChoice("none"), "none");
  assertEquals(promoChoice("best"), "best");
});

Deno.test("a code id passes through; anything else means best", () => {
  assertEquals(promoChoice("e47c0000-0000-4000-8000-000000000001"), "e47c0000-0000-4000-8000-000000000001");
  assertEquals(promoChoice("'; drop table"), "best");
  assertEquals(promoChoice(42), "best");
});
