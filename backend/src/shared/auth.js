const { verifyMessage: ethersVerifyMessage } = require("ethers");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");
const jwt = require("jsonwebtoken");

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

// viem client for Base mainnet — handles EOA, EIP-1271, and ERC-6492 natively
function getViemClient() {
  return createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org")
  });
}

async function verifySignature(address, message, signature) {
  if (!address || !message || !signature) return false;

  // 1. Try EOA first (fast, no RPC)
  try {
    const recovered = ethersVerifyMessage(message, signature);
    console.log(`[verify] EOA recovered=${recovered} expected=${address} match=${normalizeAddress(recovered) === normalizeAddress(address)}`);
    if (normalizeAddress(recovered) === normalizeAddress(address)) return true;
  } catch (err) {
    console.warn("[verify] EOA failed:", err.message);
  }

  // 2. Use viem client.verifyMessage — handles EIP-1271 and ERC-6492 (counterfactual wallets)
  try {
    const { getAddress } = require("viem");
    const client = getViemClient();
    const checksumAddress = getAddress(address);
    const valid = await client.verifyMessage({
      address: checksumAddress,
      message,
      signature
    });
    console.log(`[verify] viem result=${valid} address=${checksumAddress}`);
    if (valid) return true;
  } catch (err) {
    console.warn("[verify] viem failed:", err.message);
  }

  console.warn(`[verify] FAILED address=${address} msgLen=${message?.length} sigLen=${signature?.length}`);
  console.warn(`[verify] message first 100: ${message?.slice(0, 100)}`);
  return false;
}

function signJwt(address) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing");
  return jwt.sign({ address }, secret);
}

function verifyJwt(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing");
  return jwt.verify(token, secret);
}

module.exports = {
  normalizeAddress,
  verifySignature,
  signJwt,
  verifyJwt
};
