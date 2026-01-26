const { verifyMessage } = require("ethers");
const jwt = require("jsonwebtoken");

function normalizeAddress(address) {
  if (!address || typeof address !== "string") return null;
  return address.toLowerCase();
}

function verifySignature(address, message, signature) {
  if (!address || !message || !signature) return false;
  try {
    const recovered = verifyMessage(message, signature);
    return normalizeAddress(recovered) === normalizeAddress(address);
  } catch (err) {
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
