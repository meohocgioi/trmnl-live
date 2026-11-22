// Vòng kiểm tra: xem ai đang live (TikTok / YouTube / Facebook), chụp ảnh, lưu trạng thái, báo Telegram
import { checkLive as ttCheck, UA } from './tiktok.js';
import { checkLive as ytCheck } from './youtube.js';
import { checkLive as fbCheck } from './facebook.js';
import { idInfo } from './platforms.js';
import { screenshotTargets } from './shot.js';
import { getConfig, getState, saveState, putImage } from './store.js';
import { notifyEvents } from './telegram.js';
import { imgSize } from './util.js';

export async function saveRemoteImage(env, key, url, referer) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...(referer ? { referer } : {}) } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return false;
    const buf = await r.arrayBuffer();
    await putImage(env, key, buf, type.split(';')[0]);
    return imgSize(buf) || true;
  } catch {
    return false;
  }
}

export async function checkOne(id, env, prev = {}) {
  const { plat, handle } = idInfo(id);
  if (plat === 'yt') return ytCheck(handle, env);
  if (plat === 'fb') return fbCheck(handle, env);
  return ttCheck(handle, env, prev.roomId);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kiểm tra lần lượt (không dồn dập) để TikTok/YouTube ít chặn hơn
async function checkAll(ids, env, st) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    if (i) await sleep(800);
    out.push(await checkOne(ids[i], env, st.users[ids[i]] || {}).catch((e) => ({ error: e.message })));
  }
  return out;
}

/**
 * opts.force     : bỏ qua interval
 * opts.only      : chỉ kiểm tra 1 id
 * opts.forceShot : chụp dù đã vượt quota tự đặt
 */
export async function runCheck(env, opts = {}) {
  const { force = false, only = null, forceShot = false } = opts;
  const cfg = await getConfig(env);
  const st = await getState(env);
  const now = Date.now();

  if (!force && now - (st.lastRun || 0) < cfg.intervalMin * 60000 - 150000) {
    return { skipped: true, st, cfg };
  }

  const day = new Date(now).toISOString().slice(0, 10);
  if (!st.budget || st.budget.day !== day) st.budget = { day, ms: 0 };

  const ids = only ? [only] : cfg.users;
  const infos = await checkAll(ids, env, st);
  const events = [];
  const live = [];

  ids.forEach((id, n) => {
    const info = infos[n];
    const prev = st.users[id] || {};
    const u = { ...prev, checkedAt: now, error: info.error, source: info.source };
    if (!info.source) {
      u.unknown = true; // không đọc được -> giữ trạng thái cũ
      u.failCount = (prev.failCount || 0) + 1;
    } else {
      u.unknown = false;
      u.failCount = 0;
      u.lastOkAt = now;
      if (info.live !== !!prev.live && prev.checkedAt) {
        events.push({ id, live: info.live, title: info.title, liveSince: prev.liveSince });
      }
      if (info.live && !prev.live) u.liveSince = now;
      if (!info.live) u.liveSince = null;
      u.live = !!info.live;
      u.title = info.title || null;
      u.viewers = info.live ? info.viewers ?? null : null;
      u.nickname = info.nickname || prev.nickname || null;
      if (info.roomId) u.roomId = info.roomId;
    }
    st.users[id] = u;
    if (u.live && !u.unknown) live.push({ id, info });
    u._avatar = info.avatar;
  });

  // Avatar: làm mới mỗi ngày
  for (const id of ids) {
    const u = st.users[id];
    const a = u._avatar;
    delete u._avatar;
    if (a && (!u.avatarAt || now - u.avatarAt > 86400000)) {
      if (await saveRemoteImage(env, 'avatar:' + id, a)) u.avatarAt = now;
    }
  }

  // Ảnh khi live
  const budgetMs = cfg.browserDailySec * 1000;
  const canBrowser = !!env.BROWSER && cfg.shotMode === 'screen' && (forceShot || st.budget.ms < budgetMs);
  const targets = [];
  for (const { id, info } of live) {
    const { plat, liveUrl } = idInfo(id);
    if (plat === 'tt' && canBrowser) {
      targets.push({ id, url: liveUrl, cookie: env.TIKTOK_COOKIE, domain: '.tiktok.com' });
    } else if (plat === 'fb' && canBrowser && info.videoUrl) {
      targets.push({ id, url: info.videoUrl, cookie: env.FACEBOOK_COOKIE, domain: '.facebook.com' });
    }
  }
  let shots = {};
  if (targets.length) {
    const r = await screenshotTargets(env, targets);
    st.budget.ms += r.ms;
    shots = r.results;
  }

  for (const { id, info } of live) {
    const u = st.users[id];
    const { plat } = idInfo(id);
    const r = shots[id];
    if (r && r.png) {
      await putImage(env, 'shot:' + id, r.png, 'image/png');
      const sz = imgSize(r.png);
      u.shotW = sz?.w || null;
      u.shotH = sz?.h || null;
      u.shotAt = now;
      u.shotKind = 'screen';
      u.shotError = null;
      continue;
    }
    // YouTube: thumbnail live (TikTok/Facebook: dự phòng khi không chụp được)
    let ok = false;
    if (info.cover) {
      const bust = (info.cover.includes('?') ? '&' : '?') + 't=' + now;
      ok = await saveRemoteImage(env, 'shot:' + id, info.cover + (plat === 'yt' ? bust : ''),
        plat === 'tt' ? 'https://www.tiktok.com/' : undefined);
      if (!ok && plat === 'yt' && info.videoId) {
        ok = await saveRemoteImage(env, 'shot:' + id, `https://i.ytimg.com/vi/${info.videoId}/hqdefault_live.jpg?t=${now}`);
      }
    }
    if (ok) {
      u.shotW = ok.w || null;
      u.shotH = ok.h || null;
      u.shotAt = now;
      u.shotKind = plat === 'yt' ? 'thumb' : 'cover';
    }
    if (plat === 'yt') u.shotError = ok ? null : 'không lấy được thumbnail live';
    else if (cfg.shotMode === 'cover') u.shotError = null;
    else u.shotError = r?.error || (env.BROWSER ? (canBrowser ? 'không có link video' : 'đã hết quota trình duyệt hôm nay') : 'chưa bật Browser Rendering');
  }

  for (const k of Object.keys(st.users)) if (!cfg.users.includes(k)) delete st.users[k];
  if (!only) st.lastRun = now;
  await saveState(env, st);

  if (cfg.notify && events.length) await notifyEvents(env, cfg, st, events);
  return { skipped: false, st, cfg, events, checked: ids };
}
