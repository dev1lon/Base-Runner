const { query } = require("../../shared/db");

const APP_URL = process.env.APP_URL || "https://rugpullrun.app";
const BASE_NOTIF_URL = "https://dashboard.base.org/api/v1/notifications/send";
const BASE_NOTIF_USERS_URL = "https://dashboard.base.org/api/v1/notifications/app/users";
const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const NOTIFICATION_CHUNK_SIZE = Number(process.env.NOTIFICATION_CHUNK_SIZE || 100);

function getNotificationStatus() {
  return {
    configured: !!process.env.BASE_API_KEY,
    appUrl: APP_URL,
    endpoint: BASE_NOTIF_URL,
    usersEndpoint: BASE_NOTIF_USERS_URL,
  };
}

async function getNotificationUserStatus(walletAddress) {
  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) return { ok: false, error: "BASE_API_KEY not set" };
  if (!walletAddress) return { ok: false, error: "Missing walletAddress" };

  const target = walletAddress.toLowerCase();
  let cursor = "";

  try {
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(BASE_NOTIF_USERS_URL);
      url.searchParams.set("app_url", APP_URL);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: text };
      }

      const data = await res.json().catch(() => ({}));
      const user = (data.users || []).find(u => String(u.address || "").toLowerCase() === target);
      if (user) {
        return {
          ok: true,
          saved: true,
          notificationsEnabled: user.notificationsEnabled === true,
          user,
        };
      }

      cursor = data.nextCursor || "";
      if (!cursor) break;
    }

    return { ok: true, saved: false, notificationsEnabled: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function notificationWasSent(result) {
  if (!result?.ok) return false;
  if (Number(result.sentCount || 0) > 0) return true;
  if (Number(result.data?.sentCount || 0) > 0) return true;
  const results = Array.isArray(result.data?.results) ? result.data.results : [];
  return results.some(r => r?.sent === true);
}

async function listNotificationUsers({ enabledOnly = true } = {}) {
  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) return { ok: false, error: "BASE_API_KEY not set" };

  const users = [];
  let cursor = "";

  try {
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(BASE_NOTIF_USERS_URL);
      url.searchParams.set("app_url", APP_URL);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: text };
      }

      const data = await res.json().catch(() => ({}));
      for (const user of data.users || []) {
        const address = String(user.address || "").toLowerCase();
        if (!address) continue;
        if (enabledOnly && user.notificationsEnabled !== true) continue;
        users.push({ ...user, address });
      }

      cursor = data.nextCursor || "";
      if (!cursor) break;
    }
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendNotificationToWallets({ walletAddresses, title, message, targetPath }) {
  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) return { ok: false, error: "BASE_API_KEY not set" };

  const uniqueAddresses = [...new Set((walletAddresses || [])
    .map(address => String(address || "").toLowerCase())
    .filter(Boolean))];

  if (!uniqueAddresses.length) {
    return { ok: false, error: "No wallet addresses" };
  }

  const batches = [];
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < uniqueAddresses.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = uniqueAddresses.slice(i, i + NOTIFICATION_CHUNK_SIZE);
    try {
      const res = await fetch(BASE_NOTIF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          app_url: APP_URL,
          wallet_addresses: chunk,
          title: title.slice(0, 30),
          message: message.slice(0, 200),
          ...(targetPath ? { target_path: targetPath } : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        failedCount += chunk.length;
        batches.push({ ok: false, status: res.status, error: text, requestedCount: chunk.length });
        continue;
      }

      const data = await res.json().catch(() => ({}));
      let batchSent = Number(data.sentCount || 0)
        || (Array.isArray(data.results) ? data.results.filter(r => r?.sent === true).length : 0);
      if (batchSent === 0 && data.success === true && data.sentCount === undefined && !Array.isArray(data.results)) {
        batchSent = chunk.length;
      }
      sentCount += batchSent;
      failedCount += Math.max(0, chunk.length - batchSent);
      batches.push({ ok: data.success === true, data, requestedCount: chunk.length, sentCount: batchSent });
    } catch (e) {
      failedCount += chunk.length;
      batches.push({ ok: false, error: e.message, requestedCount: chunk.length });
    }
  }

  return {
    ok: sentCount > 0 && failedCount === 0,
    partial: sentCount > 0 && failedCount > 0,
    requestedCount: uniqueAddresses.length,
    sentCount,
    failedCount,
    batches,
  };
}

async function sendNotification({ walletAddress, title, message, targetPath }) {
  if (!walletAddress) return { ok: false, error: "Missing walletAddress" };
  const result = await sendNotificationToWallets({
    walletAddresses: [walletAddress],
    title,
    message,
    targetPath,
  });
  return {
    ok: result.sentCount > 0,
    sentCount: result.sentCount || 0,
    requestedCount: result.requestedCount || 0,
    failedCount: result.failedCount || 0,
    data: result.batches?.[0]?.data,
    error: result.error || result.batches?.[0]?.error,
  };
}

async function sendBroadcastNotification({ title, message, targetPath }) {
  const usersResult = await listNotificationUsers({ enabledOnly: true });
  if (!usersResult.ok) return usersResult;

  const walletAddresses = usersResult.users.map(u => u.address);
  if (!walletAddresses.length) {
    return { ok: false, error: "No opted-in notification users", requestedCount: 0, sentCount: 0 };
  }

  return sendNotificationToWallets({ walletAddresses, title, message, targetPath });
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
      if (notificationWasSent(r)) await markNotified(u.address);
      else console.warn(`[notifications] failed for ${u.address}:`, r.error);
    }
  } catch (e) {
    console.error("[notifications] job error:", e);
  }
}

module.exports = {
  getNotificationStatus,
  getNotificationUserStatus,
  sendNotification,
  sendBroadcastNotification,
  runCheckinReminderJob,
};
