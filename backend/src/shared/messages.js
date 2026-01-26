function buildSessionMessage(sessionId) {
  return `BaseApp Runner session ${sessionId}`;
}

function buildAuthMessage({ address, nonce, chainId, issuedAt }) {
  return [
    "Base Runner",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `ChainId: ${chainId}`,
    `IssuedAt: ${issuedAt}`
  ].join("\n");
}

function buildCheckinMessage(nonce) {
  return `BaseApp Runner check-in ${nonce}`;
}

module.exports = {
  buildSessionMessage,
  buildAuthMessage,
  buildCheckinMessage
};
