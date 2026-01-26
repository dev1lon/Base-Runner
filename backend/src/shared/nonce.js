const crypto = require("crypto");

function createNonce() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  createNonce
};
