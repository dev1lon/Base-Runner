const { verifyMessage, ethers, hashMessage } = require("ethers");
const jwt = require("jsonwebtoken");

// EIP-1271 magic value
const EIP1271_MAGIC = "0x1626ba7e";

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

async function verifySignature(address, message, signature) {
  if (!address || !message || !signature) return false;

  // 1. Try EOA verification first
  try {
    const recovered = verifyMessage(message, signature);
    if (normalizeAddress(recovered) === normalizeAddress(address)) {
      return true;
    }
  } catch (err) {
    // Not a valid EOA signature, try EIP-1271
  }

  // 2. Try EIP-1271 (smart contract wallet like Coinbase Smart Wallet)
  try {
    const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const hash = hashMessage(message);
    const contract = new ethers.Contract(address, [
      "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
    ], provider);
    const result = await contract.isValidSignature(hash, signature);
    return result === EIP1271_MAGIC;
  } catch (err) {
    console.warn("EIP-1271 verification failed:", err.message);
    return false;
  }
}

function signJwt(address) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is missing");
  }
  const expiresIn = process.env.JWT_EXPIRES || "7d";
  return jwt.sign({ address }, secret, { expiresIn });
}

function verifyJwt(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is missing");
  }
  return jwt.verify(token, secret);
}

module.exports = {
  normalizeAddress,
  verifySignature,
  signJwt,
  verifyJwt
};
