import { runCheck } from './check.js';
import { getConfig, getState, getImage } from './store.js';
import { handleTelegram, setupWebhook } from './telegram.js';
import { fmtTime, fmtDateTime } from './util.js';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Dữ liệu cho TRMNL (Polling)
async function trmnlPayload(env, origin) {
  const cfg = await getConfig(env);
  const st = await getState(env);
  let list = cfg.users.map((name) => ({ name, s: st.users[name] || {} }));
  if (list.length > 3) list = [...list].sort((a, b) => (b.s.live ? 1 : 0) - (a.s.live ? 1 : 0)).slice(0, 3);

  const users = list.map(({ name, s }) => ({
    user: name,
    nickname: s.nickname || name,
    live: !!s.live,
    unknown: !!s.unknown,
    title: s.title || '',
    viewers: s.viewers ?? '',
    image: s.live && s.shotAt ? `${origin}/img/shot/${name}?v=${s.shotAt}` : null,
    shot_kind: s.shotKind || null,
    avatar: s.avatarAt ? `${origin}/img/avatar/${name}?v=${s.avatarAt}` : null,
    checked: fmtTime(s.checkedAt) || '--:--',
    shot: fmtTime(s.shotAt) || '',
    since: fmtTime(s.liveSince) || '',
  }));
  return {
    updated: fmtDateTime(Date.now()),
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

    if (p === '/trmnl') return json(await trmnlPayload(env, url.origin));

    const m = p.match(/^\/img\/(shot|avatar)\/([\w.]+)$/);
    if (m) {
      const { value, metadata } = await getImage(env, `${m[1]}:${m[2]}`);
      if (!value) return new Response('no image', { status: 404 });
      return new Response(value, {
        headers: { 'content-type': metadata?.type || 'image/png', 'cache-control': 'public, max-age=60' },
      });
    }

    const dbg = p.match(/^\/debug\/([\w.]+)$/);
    if (dbg) {
      const { checkLive } = await import('./tiktok.js');
      return json(await checkLive(dbg[1].toLowerCase(), env));
    }

    if (p === '/tg' && req.method === 'POST') return handleTelegram(req, env, ctx);

    if (p === '/setup') return json(await setupWebhook(env, url.origin));

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env).catch((e) => console.error('runCheck', e)));
  },
};
