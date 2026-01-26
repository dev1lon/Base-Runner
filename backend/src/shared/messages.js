function buildSessionMessage(sessionId) {
  return `BaseApp Runner session ${sessionId}`;
}

function buildCheckinMessage(nonce) {
  return `BaseApp Runner check-in ${nonce}`;
}

module.exports = {
  buildSessionMessage,
  buildCheckinMessage
};
