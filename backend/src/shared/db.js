const { Pool } = require("pg");

const hasDatabaseUrl = !!process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: hasDatabaseUrl ? process.env.DATABASE_URL : undefined,
  host: hasDatabaseUrl ? undefined : process.env.PGHOST,
  port: hasDatabaseUrl ? undefined : Number(process.env.PGPORT || 5432),
  user: hasDatabaseUrl ? undefined : process.env.PGUSER,
  password: hasDatabaseUrl ? undefined : process.env.PGPASSWORD,
  database: hasDatabaseUrl ? undefined : process.env.PGDATABASE,
  ssl: String(process.env.PG_SSL || "false").toLowerCase() === "true"
    ? { rejectUnauthorized: false }
    : undefined
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      last_checkin TEXT,
      checkin_nonce TEXT,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_nonces (
      address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ;`);
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  query,
  ensureSchema
};
