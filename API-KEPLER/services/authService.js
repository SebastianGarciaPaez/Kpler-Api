const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sql, getPool } = require("../db/sql");

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}
function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailAllowed(email) {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
  if (!domain) return true;
  return email.endsWith("@" + domain);
}

// Admin: set password hash for an existing user
async function setUserPassword({ email, password }) {
  email = normalizeEmail(email);
  if (!email || !password) throw new Error("email and password required");
  if (!emailAllowed(email)) throw new Error("email not allowed");

  const pool = await getPool();

  const r = await pool.request()
    .input("Email", sql.NVarChar(255), email)
    .query(`SELECT TOP 1 Id FROM dbo.USR_Users WHERE Email=@Email`);

  if (!r.recordset.length) throw new Error("user does not exist");

  const hash = await bcrypt.hash(String(password), 12);

  await pool.request()
    .input("Email", sql.NVarChar(255), email)
    .input("Hash", sql.NVarChar(255), hash)
    .query(`UPDATE dbo.USR_Users SET PasswordHash=@Hash WHERE Email=@Email`);

  return { ok: true };
}

// Login: email+password -> token in SYS_Sessions (expires 24h)
async function login({ email, password, ip, userAgent }) {
  email = normalizeEmail(email);
  const pw = String(password || "");
  if (!email || !pw) throw new Error("email and password required");
  if (!emailAllowed(email)) throw new Error("email not allowed");

  const pool = await getPool();

  const u = await pool.request()
    .input("Email", sql.NVarChar(255), email)
    .query(`SELECT TOP 1 Id, Email, PasswordHash FROM dbo.USR_Users WHERE Email=@Email`);

  if (!u.recordset.length) throw new Error("invalid credentials");

  const user = u.recordset[0];
  if (!user.PasswordHash) throw new Error("user has no password set");

  const ok = await bcrypt.compare(pw, user.PasswordHash);
  if (!ok) throw new Error("invalid credentials");

  const tokenPlain = randomToken();
  const tokenHash = sha256(tokenPlain);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // 1 sesión por usuario (update/insert)
  await pool.request()
    .input("UserId", sql.Int, user.Id)
    .input("Token", sql.NVarChar(sql.MAX), tokenHash)
    .input("ExpiresAt", sql.DateTime, expiresAt)
    .input("IPAddress", sql.NVarChar(45), ip || null)
    .input("UserAgent", sql.NVarChar(255), userAgent || null)
    .query(`
      UPDATE dbo.SYS_Sessions
      SET Token=@Token,
          CreatedAt=GETDATE(),
          ExpiresAt=@ExpiresAt,
          IPAddress=@IPAddress,
          UserAgent=@UserAgent,
          IsRevoked=0
      WHERE UserId=@UserId;

      IF @@ROWCOUNT=0
      INSERT INTO dbo.SYS_Sessions (UUID, UserId, Token, CreatedAt, ExpiresAt, IPAddress, UserAgent, IsRevoked)
      VALUES (NEWID(), @UserId, @Token, GETDATE(), @ExpiresAt, @IPAddress, @UserAgent, 0);
    `);

  return { token: tokenPlain, expiresAt };
}

// Validate Bearer token
async function validateToken(tokenPlain) {
  const pool = await getPool();
  const tokenHash = sha256(String(tokenPlain || ""));

  const r = await pool.request()
    .input("Token", sql.NVarChar(sql.MAX), tokenHash)
    .query(`
      SELECT TOP 1 s.UUID, s.UserId, u.Email, s.ExpiresAt
      FROM dbo.SYS_Sessions s
      JOIN dbo.USR_Users u ON u.Id = s.UserId
      WHERE s.Token=@Token AND s.IsRevoked=0 AND s.ExpiresAt > GETDATE()
      ORDER BY s.CreatedAt DESC
    `);

  return r.recordset[0] || null;
}

module.exports = { setUserPassword, login, validateToken };