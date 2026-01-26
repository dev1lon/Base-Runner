function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isToday(dateKey) {
  if (!dateKey) return false;
  return dateKey === getDateKey();
}

function isYesterday(dateKey) {
  if (!dateKey) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return dateKey === getDateKey(yesterday);
}

module.exports = {
  getDateKey,
  isToday,
  isYesterday
};
