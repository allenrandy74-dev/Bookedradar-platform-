import test from "node:test";
import assert from "node:assert/strict";
import { bearerToken } from "../src/auth.js";

test("bearerToken parses bearer auth", () => {
  const req = { headers: { authorization: "Bearer abc123" } };
  assert.equal(bearerToken(req), "abc123");
});

test("bearerToken rejects non-bearer auth", () => {
  const req = { headers: { authorization: "Basic abc123" } };
  assert.equal(bearerToken(req), "");
});
