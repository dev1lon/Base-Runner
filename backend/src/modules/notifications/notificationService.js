const { query } = require("../../shared/db");

const APP_URL = process.env.APP_URL || "https://rugpullrun.app";
const BASE_NOTIF_URL = "https://dashboard.base.org/api/v1/notifications/send";
const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function getNotificationStatus() {
  return {
    configured: !!process.env.BASE_API_KEY,
    appUrl: APP_URL,
    endpoint: BASE_NOTIF_URL,
  };
}

async function sendNotification({ walletAddress, title, message, targetPath }) {
  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) return { ok: false, error: "BASE_API_KEY not set" };
  if (!walletAddress) return { ok: false, error: "Missing walletAddress" };

  try {
    const res = await fetch(BASE_NOTIF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        app_url: APP_URL,
        wallet_addresses: [walletAddress],
        title: title.slice(0, 30),
        message: message.slice(0, 200),
        ...(targetPath ? { target_path: targetPath } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: data.success === true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getCheckinReminderTargets() {
  const cooldownThreshold  = new Date(Date.now() - CHECKIN_COOLDOWN_MS);
  const streakDeadline     = new Date(Date.now() - STREAK_TIMEOUT_MS);
  const lastNotifThreshold = new Date(Date.now() - REMINDER_COOLDOWN_MS);

  const { rows } = await query(
    `SELECT address, streak
     FROM users
     WHERE last_checkin_at IS NOT NULL
       AND last_checkin_at < $1
       AND last_checkin_at > $2
       AND (last_notified_at IS NULL OR last_notified_at < $3)`,
    [cooldownThreshold, streakDeadline, lastNotifThreshold]
  );
  return rows;
}

async function markNotified(address) {
  await query(
    `UPDATE users SET last_notified_at = NOW() WHERE address = $1`,
    [address.toLowerCase()]
  );
}

async function runCheckinReminderJob() {
  try {
    const targets = await getCheckinReminderTargets();
    if (!targets.length) return;
    console.log(`[notifications] sending reminders to ${targets.length} user(s)`);
    for (const u of targets) {
      const title   = u.streak > 0 ? "Streak alert!" : "Daily check-in";
      const message = u.streak > 0
        ? `Your ${u.streak}-day streak expires in 12h. Check in now!`
        : "Your daily reward is waiting. Check in to start a streak.";
      const r = await sendNotification({
        walletAddress: u.address,
        title,
        message,
        targetPath: "/",
      });
      if (r.ok) await markNotified(u.address);
      else console.warn(`[notifications] failed for ${u.address}:`, r.error);
    }
  } catch (e) {
    console.error("[notifications] job error:", e);
  }
}

module.exports = { getNotificationStatus, sendNotification, runCheckinReminderJob };
