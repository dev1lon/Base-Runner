const { query } = require("../../shared/db");

const USER_COLUMNS = `
  address,
  coins,
  best_score,
  streak,
  last_checkin,
  last_checkin_at,
  checkin_nonce,
  last_login_at,
  created_at,
  updated_at
`;

async function getUser(address) {
  const result = await query(
    `SELECT ${USER_COLUMNS} FROM users WHERE address = $1`,
    [address]
  );
  return result.rows[0] || null;
}

async function createUser(address) {
  const result = await query(
    `INSERT INTO users (address)
     VALUES ($1)
     RETURNING ${USER_COLUMNS}`,
    [address]
  );
  return result.rows[0];
}

async function getOrCreateUser(address) {
  const existing = await getUser(address);
  if (existing) return existing;
  return createUser(address);
}

async function updateUser(address, updates) {
  const allowed = {
    coins: "coins",
    best_score: "best_score",
    streak: "streak",
    last_checkin: "last_checkin",
    last_checkin_at: "last_checkin_at",
    checkin_nonce: "checkin_nonce",
    last_login_at: "last_login_at"
  };
  const sets = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates || {})) {
    if (allowed[key]) {
      sets.push(`${allowed[key]} = $${idx}`);
      values.push(value);
      idx += 1;
    }
  }

  if (sets.length === 0) {
    return getUser(address);
  }

  sets.push(`updated_at = NOW()`);
  values.push(address);
  const result = await query(
    `UPDATE users SET ${sets.join(", ")}
     WHERE address = $${idx}
     RETURNING ${USER_COLUMNS}`,
    values
  );
  return result.rows[0];
}

module.exports = {
  getUser,
  getOrCreateUser,
  updateUser
};
