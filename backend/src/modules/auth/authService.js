const { createNonce } = require("../../shared/nonce");
const { buildAuthMessage } = require("../../shared/messages");
const { verifySignature, signJwt } = require("../../shared/auth");
const { upsertNonce, getNonce, deleteNonce } = require("./authRepo");
const { getOrCreateUser, updateUser } = require("../user/userRepo");

const NONCE_TTL_MS = Number(process.env.AUTH_NONCE_TTL_MS || 10 * 60 * 1000);

async function issueNonce(address, chainId, originalAddress) {
  const nonce = createNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  await upsertNonce({
    address,
    nonce,
    chainId,
    issuedAt,
    expiresAt,
    originalAddress: originalAddress || address
  });
  return {
    nonce,
    issuedAt: issuedAt.toISOString()
  };
}

async function verifyNonce({ address, signature, originalAddress, signedMessage }) {
  const record = await getNonce(address);
  if (!record) {
    return { ok: false, error: "Nonce not found" };
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    await deleteNonce(address);
    return { ok: false, error: "Nonce expired" };
  }
  // Use signedMessage if provided (SIWE), otherwise rebuild with legacy format.
  // A client-supplied message must still be bound to THIS login: it has to carry
  // the nonce we just issued and the address it claims. Without that check any
  // signature by the victim over any text (one harvested from another dapp, say)
  // would authenticate as them.
  if (signedMessage) {
    const msg = String(signedMessage);
    if (!msg.includes(record.nonce)) {
      return { ok: false, error: "Message does not contain the issued nonce" };
    }
    if (!msg.toLowerCase().includes(address.toLowerCase())) {
      return { ok: false, error: "Message does not contain the address" };
    }
  }
  const msgAddress = record.original_address || originalAddress || address;
  const message = signedMessage || buildAuthMessage({
    address: msgAddress,
    nonce: record.nonce,
    chainId: record.chain_id,
    issuedAt: new Date(record.issued_at).toISOString()
  });
  if (!(await verifySignature(address, message, signature))) {
    return { ok: false, error: "Invalid signature" };
  }
  await deleteNonce(address);
  const user = await getOrCreateUser(address);
  const updated = await updateUser(address, { last_login_at: new Date().toISOString() });
  return {
    ok: true,
    token: signJwt(address),
    user: updated || user
  };
}

module.exports = {
  issueNonce,
  verifyNonce
};
