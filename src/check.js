// Vòng kiểm tra: xem ai đang live, chụp ảnh, lưu trạng thái, báo Telegram
import { checkLive, UA } from './tiktok.js';
import { screenshotLives } from './shot.js';
import { getConfig, getState, saveState, putImage } from './store.js';
import { notifyEvents } from './telegram.js';

export async function saveRemoteImage(env, key, url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.tiktok.com/' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return false;
    await putImage(env, key, await r.arrayBuffer(), type.split(';')[0]);
    return true;
  } catch {
    return false;
  }
}

/**
 * opts.force     : bỏ qua interval
 * opts.only      : chỉ kiểm tra 1 user
 * opts.forceShot : chụp dù đã vượt quota tự đặt
 */
export async function runCheck(env, opts = {}) {
  const { force = false, only = null, forceShot = false } = opts;
  const cfg = await getConfig(env);
  const st = await getState(env);
  const now = Date.now();

  if (!force && now - (st.lastRun || 0) < cfg.intervalMin * 60000 - 30000) {
    return { skipped: true, st, cfg };
  }

  const day = new Date(now).toISOString().slice(0, 10);
  if (!st.budget || st.budget.day !== day) st.budget = { day, ms: 0 };

  const users = only ? [only] : cfg.users;
  const infos = await Promise.all(users.map((u) => checkLive(u, env)));
  const events = [];
  const toShot = [];
  const covers = {};

  for (const info of infos) {
    const prev = st.users[info.user] || {};
    const u = { ...prev, user: info.user, checkedAt: now, error: info.error, source: info.source };

    if (!info.source) {
      u.unknown = true; // không đọc được TikTok -> giữ trạng thái cũ
    } else {
      u.unknown = false;
      if (info.live !== !!prev.live && prev.checkedAt) {
        events.push({ user: info.user, live: info.live, title: info.title, liveSince: prev.liveSince });
      }
      if (info.live && !prev.live) u.liveSince = now;
      if (!info.live) u.liveSince = null;
      u.live = info.live;
      u.title = info.title;
      u.viewers = info.viewers;
      u.nickname = info.nickname || prev.nickname || null;
      u.roomId = info.roomId;
    }

    // Avatar: làm mới mỗi ngày
    if (info.avatar && (!prev.avatarAt || now - prev.avatarAt > 86400000)) {
      if (await saveRemoteImage(env, 'avatar:' + info.user, info.avatar)) u.avatarAt = now;
    }

    if (u.live && !u.unknown) {
      toShot.push(info.user);
      covers[info.user] = info.cover;
    }
    st.users[info.user] = u;
  }

  // Chụp màn hình
  const budgetMs = cfg.browserDailySec * 1000;
  const useBrowser = !!env.BROWSER && cfg.shotMode === 'screen' && (forceShot || st.budget.ms < budgetMs);
  let shots = {};
  if (toShot.length && useBrowser) {
    const r = await screenshotLives(env, toShot);
    st.budget.ms += r.ms;
    shots = r.results;
  }
  for (const name of toShot) {
    const u = st.users[name];
    const r = shots[name];
    if (r && r.png) {
      await putImage(env, 'shot:' + name, r.png, 'image/png');
      u.shotAt = now;
      u.shotKind = 'screen';
      u.shotError = null;
    } else {
      u.shotError =
        cfg.shotMode === 'cover'
          ? null
          : r?.error || (env.BROWSER ? 'đã hết quota trình duyệt hôm nay' : 'chưa bật Browser Rendering');
      if (covers[name] && (await saveRemoteImage(env, 'shot:' + name, covers[name]))) {
        u.shotAt = now;
        u.shotKind = 'cover';
      }
    }
  }

  for (const k of Object.keys(st.users)) if (!cfg.users.includes(k)) delete st.users[k];
  if (!only) st.lastRun = now;
  await saveState(env, st);

  if (cfg.notify && events.length) await notifyEvents(env, cfg, st, events);
  return { skipped: false, st, cfg, events, checked: users };
}
