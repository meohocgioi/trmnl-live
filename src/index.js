import { runCheck } from './check.js';
import { getConfig, getState, getImage, getPolls, recordPoll, pollSchedule } from './store.js';
import { handleTelegram, setupWebhook } from './telegram.js';
import { fmtTime, fmtDateTime } from './util.js';
import { idInfo } from './platforms.js';
import { MAX_USERS, flagsOf } from './store.js';
import { computeLayout } from './layout.js';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Dữ liệu cho TRMNL (Polling)
async function trmnlPayload(env, origin) {
  const cfg = await getConfig(env);
  const st = await getState(env);
  let list = cfg.users.map((id) => ({ id, s: st.users[id] || {} }));
  if (list.length > MAX_USERS) list = [...list].sort((a, b) => (b.s.live ? 1 : 0) - (a.s.live ? 1 : 0)).slice(0, MAX_USERS);

  const users = list.map(({ id, s }) => {
    const I = idInfo(id);
    const f = flagsOf(cfg, id);
    return {
      id,
      screen: f.screen,
      status: f.status,
      platform: I.P.name,
      user: I.display,
      nickname: s.nickname || I.display,
      live: !!s.live,
      // Lỗi tạm thời (< 30 phút) -> vẫn hiện trạng thái cũ, không hiện ???
      unknown: !!s.unknown && Date.now() - (s.lastOkAt || 0) > 30 * 60000,
      title: s.title || '',
      viewers: s.viewers ?? '',
      image: s.live && s.shotAt ? `${origin}/img/shot/${id}?v=${s.shotAt}` : null,
      shot_kind: s.shotKind || null,
      // tỉ lệ rộng/cao của ảnh live (để TRMNL co ô vừa khít ảnh)
      ar: s.shotW && s.shotH ? Math.round((s.shotW / s.shotH) * 1000) / 1000 : I.plat === 'yt' ? 1.778 : 0.5625,
      avatar: s.avatarAt ? `${origin}/img/avatar/${id}?v=${s.avatarAt}` : null,
      checked: fmtTime(s.checkedAt) || '--:--',
      shot: fmtTime(s.shotAt) || '',
      since: fmtTime(s.liveSince) || '',
    };
  });
  // Bố cục collage: chỉ người bật Screen mới có ô; thanh trạng thái cho người bật Status
  const live = users.map((u, i) => ({ i, ar: u.ar, live: u.live, screen: u.screen })).filter((u) => u.live && u.screen);
  const offCount = users.filter((u) => u.screen && !u.live).length;
  const hasStatus = users.some((u) => u.status);
  let layout = null;
  if (live.length) layout = computeLayout(live.map((l) => ({ i: l.i, ar: l.ar })), offCount, hasStatus);
  return {
    updated: fmtDateTime(Date.now()),
    layout,
    has_status: hasStatus,
    screen_count: users.filter((u) => u.screen).length,
    status_count: users.filter((u) => u.status).length,
    count: users.length,
    any_live: users.some((u) => u.live),
    users,
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/' || p === '/health') return json({ ok: true, name: 'trmnl-live' });

    if (p === '/trmnl') {
      ctx.waitUntil(recordPoll(env).catch(() => {}));
      return json(await trmnlPayload(env, url.origin));
    }

    const m = p.match(/^\/img\/(shot|avatar)\/([\w.@-]+)$/);
    if (m) {
      const { value, metadata } = await getImage(env, `${m[1]}:${m[2]}`);
      if (!value) return new Response('no image', { status: 404 });
      return new Response(value, {
        headers: { 'content-type': metadata?.type || 'image/png', 'cache-control': 'public, max-age=60' },
      });
    }

    const dbg = p.match(/^\/debug\/([\w.@-]+)$/);
    if (dbg) {
      const { checkOne } = await import('./check.js');
      const { parseEntry } = await import('./platforms.js');
      const e = parseEntry(dbg[1].replace(/^(tt|yt|fb)-/, '$1 '));
      if (!e) return json({ error: 'id không hợp lệ' }, 400);
      return json({ id: e.id, ...(await checkOne(e.id, env)) });
    }

    // Thử đọc trang YouTube/Facebook từ Cloudflare (chẩn đoán)
    if (p === '/probe') {
      const target = url.searchParams.get('u') || '';
      if (!/^https:\/\/(www\.|m\.)?(youtube\.com|facebook\.com)\//.test(target)) return json({ error: 'host' }, 400);
      const uas = {
        chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        fbbot: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      };
      const ua = uas[url.searchParams.get('ua')] || uas.chrome;
      const r = await fetch(target, {
        headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAI; CONSENT=YES+1' },
      });
      const h = await r.text();
      const pick = (re) => (h.match(re) || [])[1] || null;
      const markers = {};
      for (const k of ['isLiveNow":true', 'isLive":true', 'isUpcoming":true', 'is_live_streaming', '"is_live":true',
        'broadcast_status":"LIVE', 'LIVE_STREAM', 'login', 'checkpoint', 'live_video', 'watching now']) {
        const i = h.indexOf(k);
        markers[k] = i < 0 ? 0 : h.split(k).length - 1;
      }
      const snip = (k) => { const i = h.indexOf(k); return i < 0 ? null : h.slice(Math.max(0, i - 150), i + 250); };
      return json({
        status: r.status, finalUrl: r.url, len: h.length,
        title: pick(/<title[^>]*>([^<]*)/), ogTitle: pick(/property="og:title" content="([^"]*)/),
        ogUrl: pick(/property="og:url" content="([^"]*)/), canonical: pick(/rel="canonical" href="([^"]*)/),
        ogImage: pick(/property="og:image" content="([^"]*)/), ogType: pick(/property="og:type" content="([^"]*)/),
        markers, snipLive: snip(url.searchParams.get('k') || 'is_live'),
      });
    }

    if (p === '/tg' && req.method === 'POST') return handleTelegram(req, env, ctx);

    if (p === '/setup') return json(await setupWebhook(env, url.origin));

    return new Response('Not found', { status: 404 });
  },

  // Cron mỗi phút: nếu có người đang live và TRMNL sắp lấy dữ liệu → kiểm tra + chụp ảnh ngay trước lượt đó
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => console.error('tick', e)));
  },
};

async function tick(env) {
  const now = Date.now();
  const sch = pollSchedule(await getPolls(env));
  if (sch) {
    const st = await getState(env);
    const anyLive = Object.values(st.users || {}).some((u) => u.live);
    const lead = Math.min(180000, Math.max(80000, ((st.budget && st.budget.avgSec) || 20) * 1000 + 50000));
    if (anyLive && now >= sch.next - lead && now < sch.next + 60000) {
      const key = 'jit:' + Math.round(sch.next / 60000);
      if (!(await env.KV.get(key))) {
        await env.KV.put(key, '1', { expirationTtl: 600 });
        return runCheck(env, { force: true, jit: true });
      }
    }
  }
  return runCheck(env);
}
