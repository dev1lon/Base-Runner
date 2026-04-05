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
    const hash = hashMessage(message);

    // Decode: (address factory, bytes calldata, bytes signature)
    const inner = "0x" + signature.slice(2, -ERC6492_MAGIC.length);
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["address", "bytes", "bytes"],
      inner
    );
    const [factory, factoryCalldata, innerSig] = decoded;

    // Deploy counterfactually using eth_call with state override
    // The universal verifier contract handles this
    // Use the ERC-6492 universal validator deployed on Base
    const UNIVERSAL_VALIDATOR = "0xCe64Ca66DB8a5CcACCcCC05a9C8C74DF3d4827e6";
    const validatorAbi = [
      "function isValidSig(address _signer, bytes32 _hash, bytes calldata _signature) view returns (bool)"
    ];

    try {
      const validator = new ethers.Contract(UNIVERSAL_VALIDATOR, validatorAbi, provider);
      const valid = await validator.isValidSig(address, hash, signature);
      return valid === true;
    } catch (e) {
      // Universal validator not available, try manual: simulate deploy then check
      // Simulate factory call to get deployed bytecode, then call isValidSignature
      // This is complex — fall through to inner sig check
    }

    // Fallback: try verifying inner signature as EOA
    try {
      const recovered = verifyMessage(message, innerSig);
      if (normalizeAddress(recovered) === normalizeAddress(address)) return true;
    } catch (e) {}

    // Fallback: try EIP-1271 on the factory-computed address
    try {
      const contract = new ethers.Contract(address, [
        "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
      ], provider);
      const result = await contract.isValidSignature(hash, innerSig);
      return result === EIP1271_MAGIC;
    } catch (e) {}

    return false;
  } catch (err) {
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
