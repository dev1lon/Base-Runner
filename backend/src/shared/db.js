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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_claimed_free BOOLEAN DEFAULT FALSE;`);
  
  // Shop characters table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_characters (
      id SERIAL PRIMARY KEY,
      character_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      metadata_uri TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      max_supply INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  
  // Pending purchases (for coin reservation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_purchases (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      coins_reserved INTEGER NOT NULL,
      nonce TEXT NOT NULL UNIQUE,
      signature TEXT,
      expiry TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);
  
  // User inventory (owned NFTs cached from chain)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id SERIAL PRIMARY KEY,
      address TEXT NOT NULL,
      token_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      tx_hash TEXT,
      minted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(address, token_id)
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
