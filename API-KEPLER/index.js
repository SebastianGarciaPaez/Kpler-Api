require("dotenv").config();

const express = require("express");
const cron = require("node-cron");

const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");

const { syncAisLatestToDb } = require("./services/kplerAisSync");
const { setUserPassword, login } = require("./services/authService");
const { requireAuth } = require("./middleware/requireAuth");

const app = express();
app.use(express.json());

// Swagger
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (req, res) => res.json(swaggerSpec));

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Admin-only: set password for a user
 * Requires header X-ADMIN-KEY
 */
app.post("/auth/set-password", async (req, res) => {
  try {
    const adminKey = String(req.headers["x-admin-key"] || "");
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Invalid admin key" });
    }

    const r = await setUserPassword({
      email: req.body?.email,
      password: req.body?.password,
    });

    return res.json(r);
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Login email+password -> token (24h)
 */
app.post("/auth/login", async (req, res) => {
  try {
    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.ip;

    const ua = req.headers["user-agent"]?.toString() || "";

    const r = await login({
      email: req.body?.email,
      password: req.body?.password,
      ip,
      userAgent: ua,
    });

    return res.json({ ok: true, ...r });
  } catch (e) {
    return res
      .status(401)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

// 🔒 Protected with Bearer token
app.get("/sync/ais-latest", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 7);
    const result = await syncAisLatestToDb({ limit });
    return res.json(result);
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/sync/ais-latest", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.body?.limit || 7);
    const result = await syncAisLatestToDb({ limit });
    return res.json(result);
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

// Cron (no auth, runs inside server)
cron.schedule("*/30 * * * *", async () => {
  try {
    const r = await syncAisLatestToDb({ limit: 300 });
    console.log("[CRON] ais-latest:", r);
  } catch (e) {
    console.error("[CRON] ais-latest error:", e);
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API running on :${port}`));