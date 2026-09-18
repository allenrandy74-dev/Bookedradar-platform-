import test from "node:test";
import assert from "node:assert/strict";
import { maskPhone } from "../src/privacy.js";
test("phone masking", () => assert.equal(maskPhone("+14095551212"), "***1212"));
