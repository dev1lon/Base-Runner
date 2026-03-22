const { query } = require("../../shared/db");

const USER_COLUMNS = `
  address,
  coins,
  best_score,
  has_claimed_free,
  owned_characters,
  selected_character,
  last_login_at,
  last_checkin_at,
  streak,
  checkin_count,
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
    has_claimed_free: "has_claimed_free",
    owned_characters: "owned_characters",
    selected_character: "selected_character",
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

// Add character to user's owned_characters array
async function addOwnedCharacter(address, characterId) {
  const result = await query(
    `UPDATE users 
     SET owned_characters = owned_characters || $1::jsonb,
         updated_at = NOW()
     WHERE address = $2
     AND NOT (owned_characters @> $1::jsonb)
     RETURNING ${USER_COLUMNS}`,
    [JSON.stringify([characterId]), address]
  );
  return result.rows[0];
}

// Check if user owns a character
async function ownsCharacter(address, characterId) {
  const result = await query(
    `SELECT owned_characters @> $1::jsonb as owns
     FROM users WHERE address = $2`,
    [JSON.stringify([characterId]), address]
  );
  return result.rows[0]?.owns || false;
}

// Add coins with transaction safety
async function addCoins(address, amount) {
  const result = await query(
    `UPDATE users 
     SET coins = coins + $1,
         updated_at = NOW()
     WHERE address = $2
     RETURNING ${USER_COLUMNS}`,
    [amount, address]
  );
  return result.rows[0];
}

// Deduct coins (returns null if insufficient)
async function deductCoins(address, amount) {
  const result = await query(
    `UPDATE users 
     SET coins = coins - $1,
         updated_at = NOW()
     WHERE address = $2 AND coins >= $1
     RETURNING ${USER_COLUMNS}`,
    [amount, address]
  );
  return result.rows[0] || null;
}

module.exports = {
  getUser,
  getOrCreateUser,
  updateUser,
  addOwnedCharacter,
  ownsCharacter,
  addCoins,
  deductCoins
};
