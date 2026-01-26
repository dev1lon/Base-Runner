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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  query,
  ensureSchema
};
