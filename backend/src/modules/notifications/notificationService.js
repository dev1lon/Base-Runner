const { query } = require("../../shared/db");

const APP_URL = process.env.APP_URL || "https://rugpullrun.app";
const BASE_NOTIF_URL = "https://dashboard.base.org/api/v1/notifications/send";
const BASE_NOTIF_USERS_URL = "https://dashboard.base.org/api/v1/notifications/app/users";
const BASE_NOTIF_USER_STATUS_URL = "https://dashboard.base.org/api/v1/notifications/app/user/status";
const CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STREAK_TIMEOUT_MS   = 36 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const NOTIFICATION_CHUNK_SIZE = Number(process.env.NOTIFICATION_CHUNK_SIZE || 500);
const NOTIFICATION_RATE_LIMIT_MS = 3500; // 20 req/min -> ~3s between batches
const reminderStats = {
  lastRunAt: null,
  lastTargetCount: 0,
  lastSentCount: 0,
  lastFailedCount: 0,
  lastError: null,
};

function getNotificationStatus() {
  return {
    configured: !!process.env.BASE_API_KEY,
    appUrl: APP_URL,
    endpoint: BASE_NOTIF_URL,
    usersEndpoint: BASE_NOTIF_USERS_URL,
    checkinReminder: reminderStats,
  };
}

async function getNotificationUserStatus(walletAddress) {
  const apiKey = process.env.BASE_API_KEY;
  if (!apiKey) return { ok: false, error: "BASE_API_KEY not set" };
  if (!walletAddress) return { ok: false, error: "Missing walletAddress" };

  try {
    const res = await fetch(BASE_NOTIF_USER_STATUS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ app_url: APP_URL, wallet_address: walletAddress }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      saved: data.appPinned === true,
      notificationsEnabled: data.notificationsEnabled === true,
      raw: data,
    };
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
      url.searchParams.set("limit", "500");
      if (enabledOnly) url.searchParams.set("notification_enabled", "true");
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

  const safeTitle   = (title   || "").slice(0, 30);
  const safeMessage = (message || "").slice(0, 200);

  for (let i = 0; i < uniqueAddresses.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = uniqueAddresses.slice(i, i + NOTIFICATION_CHUNK_SIZE);

    // Throttle: Base API limits 20 req/min — wait ~3.5s between batches
    if (i > 0) {
      await new Promise(r => setTimeout(r, NOTIFICATION_RATE_LIMIT_MS));
    }

    try {
      const res = await fetch(BASE_NOTIF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          app_url: APP_URL,
          wallet_addresses: chunk,
          title: safeTitle,
          message: safeMessage,
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

// Rotating copy — avoids Base's 24h duplicate-notification suppression
const STREAK_REMINDER_VARIANTS = [
  { title: "Don't lose your streak", msg: (s) => `${s}-day streak runs out in 12h. Jump back in.` },
  { title: "Streak alert",            msg: (s) => `Your ${s}-day run is at risk — check in to keep it alive.` },
  { title: "Keep the streak going",   msg: (s) => `${s} days strong. Don't let it reset — quick check-in waiting.` },
  { title: "Streak expires soon",     msg: (s) => `12h left to save your ${s}-day streak. One tap to fix it.` },
];
const NEW_USER_REMINDER_VARIANTS = [
  { title: "Daily reward ready",  msg: "Your check-in is waiting. Start a streak today." },
  { title: "Come back today",     msg: "Free reward sitting in your account — claim it now." },
  { title: "Don't miss out",      msg: "Open the app and grab today's check-in bonus." },
  { title: "Pull yourself in",    msg: "Daily reward + the chance to start a streak. Just one tap." },
];

function pickVariant(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function runCheckinReminderJob() {
  reminderStats.lastRunAt = new Date().toISOString();
  reminderStats.lastTargetCount = 0;
  reminderStats.lastSentCount = 0;
  reminderStats.lastFailedCount = 0;
  reminderStats.lastError = null;

  try {
    const targets = await getCheckinReminderTargets();
    reminderStats.lastTargetCount = targets.length;
    if (!targets.length) return { ok: true, ...reminderStats };
    console.log(`[notifications] sending reminders to ${targets.length} user(s)`);
    for (const u of targets) {
      const variant = u.streak > 0
        ? pickVariant(STREAK_REMINDER_VARIANTS)
        : pickVariant(NEW_USER_REMINDER_VARIANTS);
      const title   = variant.title;
      const message = typeof variant.msg === "function" ? variant.msg(u.streak) : variant.msg;
      const r = await sendNotification({
        walletAddress: u.address,
        title,
        message,
        targetPath: "/",
      });
      if (notificationWasSent(r)) {
        reminderStats.lastSentCount += 1;
        await markNotified(u.address);
      } else {
        reminderStats.lastFailedCount += 1;
        console.warn(`[notifications] failed for ${u.address}:`, r.error);
      }
    }
    return { ok: true, ...reminderStats };
  } catch (e) {
    reminderStats.lastError = e.message;
    console.error("[notifications] job error:", e);
    return { ok: false, ...reminderStats };
  }
}

module.exports = {
  getNotificationStatus,
  getNotificationUserStatus,
  sendNotification,
  sendBroadcastNotification,
  runCheckinReminderJob,
};
