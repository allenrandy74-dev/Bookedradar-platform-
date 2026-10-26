import test from "node:test";
import assert from "node:assert/strict";
import { bookedRadarPublicOrigin } from "../src/public-site-cors.js";

test("BookedRadar public CORS accepts only the two production origins and same-origin requests", () => {
  assert.deepEqual(bookedRadarPublicOrigin(""), { allowed: true, origin: "" });
  assert.deepEqual(bookedRadarPublicOrigin("https://www.bookedradar.com"), { allowed: true, origin: "https://www.bookedradar.com" });
  assert.deepEqual(bookedRadarPublicOrigin("https://bookedradar.com"), { allowed: true, origin: "https://bookedradar.com" });
  assert.equal(bookedRadarPublicOrigin("https://example.com").allowed, false);
  assert.equal(bookedRadarPublicOrigin("https://bookedradar.com.evil.example").allowed, false);
});
