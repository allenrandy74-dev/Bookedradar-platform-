import test from "node:test";
import assert from "node:assert/strict";
import { bookedRadarPublicOrigin } from "../src/public-site-cors.js";

test("BookedRadar public CORS accepts the branded site origins and requests without an Origin header", () => {
  assert.deepEqual(bookedRadarPublicOrigin(""), { allowed: true, origin: "" });
  assert.deepEqual(bookedRadarPublicOrigin("https://www.bookedradar.com"), { allowed: true, origin: "https://www.bookedradar.com" });
  assert.deepEqual(bookedRadarPublicOrigin("https://bookedradar.com"), { allowed: true, origin: "https://bookedradar.com" });
  assert.equal(bookedRadarPublicOrigin("https://example.com").allowed, false);
  assert.equal(bookedRadarPublicOrigin("https://bookedradar.com.evil.example").allowed, false);
});

test("the signup page on the platform can submit from its own origin", () => {
  const origin = "https://bookedradar-platform.onrender.com";
  assert.deepEqual(bookedRadarPublicOrigin(origin), { allowed: true, origin });
  assert.equal(bookedRadarPublicOrigin("https://another-service.onrender.com").allowed, false);
});
