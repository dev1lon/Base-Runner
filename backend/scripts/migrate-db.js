#!/usr/bin/env node
/**
 * Copy the game database from one Postgres to another (Render -> Supabase).
 *
 * The schema is created on the target by the app's own ensureSchema(), so the
 * two databases can never drift: there is no second copy of the DDL to keep in
 * sync. Data is then copied table by table with ON CONFLICT DO NOTHING, which
 * makes the whole run repeatable — an interrupted migration is fixed by running
 * it again.
 *
 * Usage:
 *   SOURCE_DATABASE_URL=postgres://...render.com/db \
 *   TARGET_DATABASE_URL=postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres \
 *   node scripts/migrate-db.js
 *
 * Flags:
 *   --dry-run         connect, create the schema, print row counts, copy nothing
 *   --include-nonces  also copy auth_nonces (skipped by default: they expire in
 *                     10 minutes, so copying them only re-creates dead rows)
 *
 * Run it from anywhere that can reach BOTH databases. Render's Postgres host is
 * under *.render.com, so if that domain is blocked on your network, run this in
 * the Render shell instead of locally.
 */

const { Client } = require("pg");

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || "";
const TARGET_URL = process.env.TARGET_DATABASE_URL || "";
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_NONCES = process.argv.includes("--include-nonces");

// Order does not matter (no foreign keys), but users first means the most
// valuable table is copied before anything can go wrong.
const TABLES = [
  { name: "users", idColumn: null },
  { name: "used_tx_hashes", idColumn: null },
  { name: "shop_characters", idColumn: "id" },
  { name: "user_inventory", idColumn: "id" },
  { name: "pending_purchases", idColumn: "id" },
  { name: "auth_nonces", idColumn: null, skipUnless: "nonces" }
];

const BATCH_SIZE = 500;

function connect(url, label) {
  if (!url) throw new Error(`${label} is not set`);
  // Both Render and Supabase terminate TLS with certificates this client has no
  // chain for; the connection is still encrypted. `?sslmode=disable` opts out,
  // which is what a local Postgres (no TLS at all) needs.
  const ssl = /[?&]sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
  return new Client({ connectionString: url, ssl });
}

async function countRows(client, table) {
  try {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return r.rows[0].n;
  } catch {
    return null; // table missing
  }
}

/** Column names and types, in ordinal order, as that database defines them. */
async function describe(client, table) {
  const r = await client.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((row) => ({ name: row.column_name, type: row.data_type }));
}

/**
 * node-pg turns a JS array into a Postgres array literal, which a jsonb column
 * rejects (owned_characters would arrive as {1,2} instead of [1,2]). Serialize
 * json/jsonb values explicitly so they land as the same JSON they came from.
 */
function prepareValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type === "json" || type === "jsonb") return JSON.stringify(value);
  return value;
}

async function copyTable(source, target, table, columns) {
  const colList = columns.map((c) => `"${c.name}"`).join(", ");
  const { rows } = await source.query(`SELECT ${colList} FROM ${table}`);
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((c) => {
        params.push(prepareValue(row[c.name], c.type));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const res = await target.query(
      `INSERT INTO ${table} (${colList}) VALUES ${tuples.join(", ")}
       ON CONFLICT DO NOTHING`,
      params
    );
    inserted += res.rowCount;
  }
  return inserted;
}

/**
 * Copying explicit ids leaves the sequence behind them, so the next insert would
 * collide. Push each sequence past the highest id that now exists.
 */
async function resyncSequence(target, table, idColumn) {
  await target.query(
    `SELECT setval(
       pg_get_serial_sequence($1, $2),
       COALESCE((SELECT MAX(${idColumn}) FROM ${table}), 1),
       (SELECT MAX(${idColumn}) FROM ${table}) IS NOT NULL
     )`,
    [table, idColumn]
  );
}

/**
 * Supabase exposes every public table through PostgREST with the project's anon
 * key, which is meant to be public. Row Level Security with no policies closes
 * that door; the backend connects as the owning role over plain Postgres and is
 * unaffected.
 */
async function lockDownPublicTables(target) {
  for (const { name } of TABLES) {
    try {
      await target.query(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
    } catch (e) {
      console.warn(`  ! could not enable RLS on ${name}: ${e.message}`);
    }
  }
}

async function main() {
  const source = connect(SOURCE_URL, "SOURCE_DATABASE_URL");
  const target = connect(TARGET_URL, "TARGET_DATABASE_URL");

  await source.connect();
  console.log(`source: ${new URL(SOURCE_URL).host}`);
  await target.connect();
  console.log(`target: ${new URL(TARGET_URL).host}`);

  // Create the schema on the target using the app's own definition.
  process.env.DATABASE_URL = TARGET_URL;
  process.env.PG_SSL = /[?&]sslmode=disable/.test(TARGET_URL) ? "false" : "true";
  const { ensureSchema } = require("../src/shared/db");
  await ensureSchema();
  console.log("schema ready on target");

  console.log("\ntable                 source   target(before)");
  for (const { name } of TABLES) {
    const s = await countRows(source, name);
    const t = await countRows(target, name);
    console.log(`  ${name.padEnd(20)} ${String(s ?? "-").padStart(6)} ${String(t ?? "-").padStart(9)}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing copied");
  } else {
    console.log("");
    for (const { name, idColumn, skipUnless } of TABLES) {
      if (skipUnless === "nonces" && !INCLUDE_NONCES) {
        console.log(`  ${name}: skipped (pass --include-nonces to copy)`);
        continue;
      }
      const targetColumns = await describe(target, name);
      if (!targetColumns.length) {
        console.log(`  ${name}: missing on target, skipped`);
        continue;
      }
      const sourceNames = new Set((await describe(source, name)).map((c) => c.name));
      // Only copy columns both sides have — a column that exists on one side
      // must not abort the run.
      const shared = targetColumns.filter((c) => sourceNames.has(c.name));
      const missing = targetColumns.filter((c) => !sourceNames.has(c.name)).map((c) => c.name);
      if (missing.length) console.log(`  ${name}: target-only columns left at default: ${missing.join(", ")}`);

      const inserted = await copyTable(source, target, name, shared);
      if (idColumn) await resyncSequence(target, name, idColumn);
      console.log(`  ${name}: ${inserted} rows inserted`);
    }
    await lockDownPublicTables(target);
    console.log("\nRLS enabled on target tables");
  }

  console.log("\ntable                 source   target(after)");
  let mismatch = false;
  for (const { name, skipUnless } of TABLES) {
    const s = await countRows(source, name);
    const t = await countRows(target, name);
    const skipped = skipUnless === "nonces" && !INCLUDE_NONCES;
    const flag = !skipped && !DRY_RUN && s !== t ? "  <-- differs" : "";
    if (flag) mismatch = true;
    console.log(`  ${name.padEnd(20)} ${String(s ?? "-").padStart(6)} ${String(t ?? "-").padStart(9)}${flag}`);
  }

  await source.end();
  await target.end();

  if (mismatch) {
    console.log("\nSome counts differ. Rows already present on the target are kept");
    console.log("(ON CONFLICT DO NOTHING), so re-running is safe — check the rows above.");
    process.exitCode = 1;
  } else if (!DRY_RUN) {
    console.log("\nDone. Point DATABASE_URL at the target and restart the backend.");
  }
}

main().catch((err) => {
  console.error("\nmigration failed:", err.message);
  process.exit(1);
});
