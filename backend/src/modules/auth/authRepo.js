const { query } = require("../../shared/db");

async function upsertNonce({ address, nonce, chainId, issuedAt, expiresAt }) {
  await query(
    `INSERT INTO auth_nonces (address, nonce, chain_id, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (address)
     DO UPDATE SET nonce = EXCLUDED.nonce,
                   chain_id = EXCLUDED.chain_id,
                   issued_at = EXCLUDED.issued_at,
                   expires_at = EXCLUDED.expires_at`,
    [address, nonce, chainId, issuedAt, expiresAt]
  );
}

async function getNonce(address) {
  const result = await query(
    `SELECT address, nonce, chain_id, issued_at, expires_at
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
