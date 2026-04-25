const { query } = require("../../shared/db");

const APP_URL = process.env.APP_URL || "https://rugpullrun.app";
const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // don't re-notify the same user within 6h

/**
 * Send a push notification to a Base App / Farcaster user.
 * Uses the notification_url + notification_token saved when user added the mini-app.
 */
async function sendNotification({ url, token, title, body, targetUrl, notificationId }) {
  if (!url || !token) return { ok: false, error: "Missing url or token" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationId: notificationId || `rpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title.slice(0, 32),
        body: body.slice(0, 128),
        targetUrl: targetUrl || APP_URL,
        tokens: [token],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Save / update notification credentials for a user (called from webhook).
 * Address is optional — if we have FID-only, address can be linked later from frontend.
 */
async function saveNotificationToken({ fid, address, url, token }) {
  if (!fid) return;
  if (address) {
    await query(
      `UPDATE users SET fid=$1, notification_url=$2, notification_token=$3, updated_at=NOW() WHERE address=$4`,
      [fid, url, token, address.toLowerCase()]
    );
  } else {
    // No address yet → store on whichever user already has this fid
    await query(
      `UPDATE users SET notification_url=$1, notification_token=$2, updated_at=NOW() WHERE fid=$3`,
      [url, token, fid]
    );
  }
}

async function clearNotificationToken({ fid }) {
  if (!fid) return;
  await query(
    `UPDATE users SET notification_url=NULL, notification_token=NULL WHERE fid=$1`,
    [fid]
  );
}

/**
 * Link a wallet address to a Farcaster FID (called from frontend after SIWE auth
 * if Farcaster context is available).
 */
async function linkFidToAddress({ address, fid }) {
  if (!address || !fid) return;
  await query(
    `UPDATE users SET fid=$1, updated_at=NOW() WHERE address=$2`,
    [fid, address.toLowerCase()]
  );
}

/**
 * Find users whose 24h cooldown just expired (so they can check in now)
 * and who haven't been notified in the last REMINDER_COOLDOWN_MS,
 * and who have a streak that'll expire if they don't act soon (within STREAK_TIMEOUT_MS).
 */
async function getCheckinReminderTargets() {
  const cooldownThreshold = new Date(Date.now() - CHECKIN_COOLDOWN_MS);
  const streakDeadline    = new Date(Date.now() - STREAK_TIMEOUT_MS);
  const lastNotifThreshold = new Date(Date.now() - REMINDER_COOLDOWN_MS);

  const { rows } = await query(
    `SELECT address, fid, notification_url, notification_token, streak
     FROM users
     WHERE notification_token IS NOT NULL
       AND last_checkin_at IS NOT NULL
       AND last_checkin_at < $1
       AND last_checkin_at > $2
       AND (last_notified_at IS NULL OR last_notified_at < $3)`,
    [cooldownThreshold, streakDeadline, lastNotifThreshold]
  );
  return rows;
}

async function markNotified(address) {
  await query(
    `UPDATE users SET last_notified_at=NOW() WHERE address=$1`,
    [address.toLowerCase()]
  );
}

/**
 * Periodic job: send reminder to users with active streak about to expire.
 */
async function runCheckinReminderJob() {
  try {
    const targets = await getCheckinReminderTargets();
    if (!targets.length) return;
    console.log(`[notifications] sending check-in reminders to ${targets.length} user(s)`);
    for (const u of targets) {
      const title = "Daily check-in ready";
      const body  = u.streak > 0
        ? `Keep your ${u.streak}-day streak alive! Check in now.`
        : `Your daily reward is waiting. Check in to start a streak.`;
      const r = await sendNotification({
        url:   u.notification_url,
        token: u.notification_token,
        title,
        body,
        targetUrl: APP_URL,
      });
      if (r.ok) await markNotified(u.address);
      else console.warn(`[notifications] send failed for ${u.address}:`, r.error);
    }
  } catch (e) {
    console.error("[notifications] job error:", e);
  }
}

module.exports = {
  sendNotification,
  saveNotificationToken,
  clearNotificationToken,
  linkFidToAddress,
  runCheckinReminderJob,
};
