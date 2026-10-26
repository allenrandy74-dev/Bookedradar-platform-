const ALLOWED_BOOKEDRADAR_ORIGINS = new Set([
  "https://www.bookedradar.com",
  "https://bookedradar.com",
]);

export function bookedRadarPublicOrigin(origin = "") {
  const normalized = String(origin || "").trim();
  if (!normalized) return { allowed: true, origin: "" };
  if (!ALLOWED_BOOKEDRADAR_ORIGINS.has(normalized)) return { allowed: false, origin: normalized };
  return { allowed: true, origin: normalized };
}

export function applyBookedRadarPublicCors(req, res) {
  const result = bookedRadarPublicOrigin(req.get("Origin"));
  if (!result.allowed) return false;
  if (result.origin) {
    res.setHeader("Access-Control-Allow-Origin", result.origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return true;
}
