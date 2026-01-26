const fs = require("fs");
const path = require("path");

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "..", "data", "db.json");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const defaultState = { users: {} };
let state = defaultState;

function load() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultState, null, 2));
    state = { ...defaultState };
    return;
  }
  const raw = fs.readFileSync(dbPath, "utf-8");
  state = raw ? JSON.parse(raw) : { ...defaultState };
  if (!state.users) {
    state.users = {};
  }
}

function save() {
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2));
}

function getUserRecord(address) {
  return state.users[address] || null;
}

function setUserRecord(address, data) {
  state.users[address] = data;
  save();
  return state.users[address];
}

load();

module.exports = {
  getUserRecord,
  setUserRecord
};
