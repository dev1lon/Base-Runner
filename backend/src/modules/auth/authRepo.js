const { query } = require("../../shared/db");

async function upsertNonce({ address, nonce, chainId, issuedAt, expiresAt, originalAddress }) {
  // Add original_address column if it doesn't exist (migration)
  try {
    await query(`ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS original_address TEXT`);
  } catch (e) {}
  await query(
    `INSERT INTO auth_nonces (address, nonce, chain_id, issued_at, expires_at, original_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (address)
     DO UPDATE SET nonce = EXCLUDED.nonce,
                   chain_id = EXCLUDED.chain_id,
                   issued_at = EXCLUDED.issued_at,
                   expires_at = EXCLUDED.expires_at,
                   original_address = EXCLUDED.original_address`,
    [address, nonce, chainId, issuedAt, expiresAt, originalAddress || address]
  );
}

async function getNonce(address) {
  const result = await query(
    `SELECT address, nonce, chain_id, issued_at, expires_at, original_address
     FROM auth_nonces WHERE address = $1`,
    [address]
  );
  return result.rows[0] || null;
}

async function deleteNonce(address) {
  await query(`DELETE FROM auth_nonces WHERE address = $1`, [address]);
}

module.exports = {
  upsertNonce,
  getNonce,
  deleteNonce
};
