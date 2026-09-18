import crypto from "node:crypto";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function bearerToken(req) {
  const value = String(req.headers?.authorization || "");
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

export function requireBearer(secret, label = "token") {
  return (req, res, next) => {
    if (!secret) {
      return res.status(503).json({
        ok: false,
        error: `${label}_not_configured`,
      });
    }
    if (!safeEqual(bearerToken(req), secret)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  };
}
