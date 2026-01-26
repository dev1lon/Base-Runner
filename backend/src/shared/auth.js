const { verifyMessage } = require("ethers");

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

module.exports = {
  normalizeAddress,
  verifySignature
};
