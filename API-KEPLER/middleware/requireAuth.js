const { validateToken } = require("../services/authService");

async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const session = await validateToken(m[1].trim());
    if (!session) return res.status(401).json({ ok: false, error: "Invalid or expired token" });

    req.user = { id: session.UserId, email: session.Email, sessionUuid: session.UUID };
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

module.exports = { requireAuth };