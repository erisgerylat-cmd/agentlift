import assert from "node:assert/strict";
import test from "node:test";
import { sum } from "./sum.mjs";

test("sum handles positive and negative operands", () => {
  assert.equal(sum(2, 3), 5);
  assert.equal(sum(-4, 1), -3);
});
