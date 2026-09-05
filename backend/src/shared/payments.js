const { withTransaction } = require('./db');

function normalizeTxHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase() : null;
}

// Claim, grant the benefit, and remember the response in ONE transaction.
// A lost HTTP response can safely be retried; a failed grant rolls back the claim.
async function applyPayment(txHash, kind, address, grant) {
  const hash = normalizeTxHash(txHash);
  if (!hash) throw new Error('Invalid payment transaction hash');
  return withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [hash + ':' + kind]);
    const { rows } = await client.query(
      'SELECT address, result FROM used_tx_hashes WHERE lower(tx_hash) = $1 AND kind = $2',
      [hash, kind]
    );
    if (rows.length) {
      const previous = rows.find(row => row.address === address && row.result);
      if (previous) return previous.result;
      throw new Error('Transaction already used');
    }
    const result = await grant(client);
    await client.query(
      'INSERT INTO used_tx_hashes (tx_hash, kind, address, result) VALUES ($1, $2, $3, $4)',
      [hash, kind, address, JSON.stringify(result)]
    );
    return result;
  });
}

module.exports = { normalizeTxHash, applyPayment };
