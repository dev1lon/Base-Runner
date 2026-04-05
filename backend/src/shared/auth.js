const { verifyMessage, ethers, hashMessage } = require("ethers");
const jwt = require("jsonwebtoken");

// EIP-1271 magic value
const EIP1271_MAGIC = "0x1626ba7e";
// ERC-6492 magic suffix (for counterfactual/undeployed smart wallets)
const ERC6492_MAGIC = "6492649264926492649264926492649264926492649264926492649264926492";

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

// Verify ERC-6492 signature (counterfactual smart wallet — not yet deployed)
// Format: abi.encode(factory, calldata, sig) + MAGIC_SUFFIX
async function verifyERC6492(address, message, signature) {
  try {
    const rpcUrl = process.env.RPC_URL || "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // ERC-6492 Universal Validator — canonical address per EIP-6492 spec
    const UNIVERSAL_VALIDATOR = "0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC";
    const validatorAbi = [
      "function isValidSig(address _signer, bytes32 _hash, bytes calldata _signature) view returns (bool)"
    ];
    const validator = new ethers.Contract(UNIVERSAL_VALIDATOR, validatorAbi, provider);

    // Try 1: prefixed hash (standard personal_sign)
    try {
      const hash = hashMessage(message);
      const valid = await validator.isValidSig(address, hash, signature);
      if (valid === true) return true;
    } catch (e) {
      console.warn("ERC-6492 prefixed hash failed:", e.message);
    }

    // Try 2: raw keccak256 (some wallets skip prefix for hex-encoded data)
    try {
      const rawHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const valid = await validator.isValidSig(address, rawHash, signature);
      if (valid === true) return true;
    } catch (e) {
      console.warn("ERC-6492 raw hash failed:", e.message);
    }

    return false;
  } catch (err) {
    console.warn("ERC-6492 verify error:", err.message);
    return false;
  }
}

async function verifySignature(address, message, signature) {
  if (!address || !message || !signature) return false;

  // 1. Try EOA verification first
  try {
    const recovered = verifyMessage(message, signature);
    if (normalizeAddress(recovered) === normalizeAddress(address)) {
      return true;
    }
  } catch (err) {}

  // 2. Check for ERC-6492 (counterfactual smart wallet, signature ends with magic suffix)
  if (signature.toLowerCase().endsWith(ERC6492_MAGIC)) {
    const ok = await verifyERC6492(address, message, signature);
    if (ok) return true;
  }

  // 3. Try EIP-1271 (deployed smart contract wallet like Coinbase Smart Wallet)
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
