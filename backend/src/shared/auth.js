const { verifyMessage: ethersVerifyMessage, ethers, hashMessage } = require("ethers");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");
const jwt = require("jsonwebtoken");

// EIP-1271 magic value
const EIP1271_MAGIC = "0x1626ba7e";

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

// viem client for Base mainnet — handles EOA, EIP-1271, and ERC-6492 natively
function getViemClient() {
  const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  });
}

async function verifySignature(address, message, signature) {
  if (!address || !message || !signature) return false;

  // 1. Try EOA first (fast, no RPC)
  try {
    const recovered = ethersVerifyMessage(message, signature);
    if (normalizeAddress(recovered) === normalizeAddress(address)) return true;
  } catch (err) {}

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
    if (valid) return true;
  } catch (err) {
    console.warn("viem verifyMessage failed:", err.message);
  }

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
