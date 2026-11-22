// Bot Telegram điều khiển plugin (chỉ chủ bot dùng được)
import { runCheck } from './check.js';
import { getConfig, saveConfig, getState, getImage, MAX_USERS } from './store.js';
import { parseEntry, idInfo, splitId } from './platforms.js';
import { fmtTime, fmtDur, esc } from './util.js';
import { trmnlPreview } from './trmnl.js';

const API = (env, m) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${m}`;

async function tg(env, method, body) {
  const r = await fetch(API(env, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

const kbMarkup = (kb) => (kb ? { reply_markup: { inline_keyboard: kb } } : {});

function sendMsg(env, chatId, text, kb) {
  return tg(env, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...kbMarkup(kb),
  });
}

async function editOrSend(env, chatId, msgId, text, kb) {
  if (msgId) {
    const r = await tg(env, 'editMessageText', {
      chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...kbMarkup(kb),
    });
    if (r.ok || String(r.description || '').includes('not modified')) return r;
  }
  return sendMsg(env, chatId, text, kb);
}

async function sendPhotoFromKV(env, chatId, key, caption) {
  const { value, metadata } = await getImage(env, key);
  if (!value) return false;
  return sendPhotoBytes(env, chatId, value, metadata?.type, caption);
}

async function sendPhotoBytes(env, chatId, value, type, caption, kb) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', caption);
  fd.append('parse_mode', 'HTML');
  if (kb) fd.append('reply_markup', JSON.stringify({ inline_keyboard: kb }));
  fd.append('photo', new Blob([value], { type: type || 'image/png' }), 'live.png');
  const r = await fetch(API(env, 'sendPhoto'), { method: 'POST', body: fd });
  return r.ok;
}

async function secretToken(env) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('trmnl-live:' + env.TELEGRAM_BOT_TOKEN));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

const COMMANDS = [
  { command: 'status', description: '📊 Ai đang live' },
  { command: 'shot', description: '📸 Kiểm tra & chụp ngay' },
  { command: 'list', description: '👥 Danh sách theo dõi' },
  { command: 'add', description: '➕ Thêm: /add link TikTok/YouTube/Facebook' },
  { command: 'remove', description: '➖ Xoá người theo dõi' },
  { command: 'settings', description: '⚙️ Cài đặt' },
  { command: 'preview', description: '🖼 Xem trước màn hình TRMNL' },
  { command: 'trmnl', description: '🔗 Link Polling URL cho TRMNL' },
  { command: 'update', description: '🔄 Cập nhật code mới nhất từ GitHub' },
  { command: 'version', description: '🏷 Phiên bản đang chạy' },
  { command: 'help', description: '❓ Hướng dẫn' },
];

export async function setupWebhook(env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'Chưa có TELEGRAM_BOT_TOKEN' };
  const webhook = await tg(env, 'setWebhook', {
    url: origin + '/tg',
    secret_token: await secretToken(env),
    allowed_updates: ['message', 'callback_query'],
  });
  const commands = await tg(env, 'setMyCommands', { commands: COMMANDS });

  // Báo chủ bot khi vừa cập nhật phiên bản mới
  let notified = false;
  const cfg = await getConfig(env);
  const owner = env.TELEGRAM_OWNER_ID || cfg.ownerId;
  if (owner && env.VERSION && (await env.KV.get('notifiedVersion')) !== env.VERSION) {
    await sendMsg(env, owner, `✅ <b>Đã cập nhật xong!</b>\n🏷 Phiên bản <code>${esc(env.VERSION)}</code>\n📝 ${esc(env.VERSION_MSG || '')}`, MAIN_KB);
    await env.KV.put('notifiedVersion', env.VERSION);
    notified = true;
  }
  return { ok: !!webhook.ok, version: env.VERSION || null, notified, webhook, commands };
}

// ---------- Nội dung tin nhắn ----------
const MAIN_KB = [
  [{ text: '📊 Trạng thái', callback_data: 'status' }, { text: '📸 Chụp ngay', callback_data: 'shot' }],
  [{ text: '🖼 Preview TRMNL', callback_data: 'preview' }],
  [{ text: '👥 Danh sách', callback_data: 'list' }, { text: '⚙️ Cài đặt', callback_data: 'settings' }],
];
const BACK_KB = [[{ text: '⬅️ Menu', callback_data: 'menu' }]];

function budgetSec(st) {
  const today = new Date().toISOString().slice(0, 10);
  return st.budget && st.budget.day === today ? Math.round(st.budget.ms / 1000) : 0;
}

function userBlock(id, s, now) {
  const I = idInfo(id);
  const link = `${I.P.icon} <a href="${I.liveUrl}">${esc(I.display)}</a>`;
  const nick = s.nickname && s.nickname.toLowerCase() !== I.handle ? ` (${esc(s.nickname)})` : '';
  const longFail = s.unknown && now - (s.lastOkAt || 0) > 30 * 60000;
  const badge = longFail ? '❓ <b>KHÔNG RÕ</b>' : s.live ? '🔴 <b>LIVE</b>' : '⚫ <b>OFFLINE</b>';
  const L = [`${badge} · ${link}${nick}`];
  if (s.live) {
    if (s.title) L.push(`   📝 ${esc(s.title)}`);
    const v = s.viewers != null && s.viewers !== '' ? `👁 <b>${s.viewers}</b> người xem · ` : '';
    if (s.liveSince) L.push(`   ${v}⏳ live từ ${fmtTime(s.liveSince)} (${fmtDur(now - s.liveSince)})`);
    else if (v) L.push(`   ${v.replace(/ · $/, '')}`);
    if (s.shotAt) L.push(`   📸 Ảnh lúc ${fmtTime(s.shotAt)} · ${KIND[s.shotKind] || 'ảnh'}`);
    if (s.shotError) L.push(`   ⚠️ <i>${esc(s.shotError)}</i>`);
  }
  if (s.unknown && !longFail) L.push(`   ⚠️ <i>Lần kiểm tra vừa rồi bị ${idInfo(id).P.name} chặn — đang giữ trạng thái lần trước, sẽ thử lại</i>`);
  if (longFail && s.error) L.push(`   ⚠️ <i>${esc(s.error).slice(0, 300)}</i>`);
  L.push(`   🕒 Kiểm tra lúc ${fmtTime(s.checkedAt) || '<i>chưa</i>'}`);
  return L.join('\n');
}

const KIND = { screen: 'chụp màn hình', thumb: 'thumbnail live', cover: 'ảnh cover' };

function statusText(cfg, st, names) {
  const now = Date.now();
  const list = names || cfg.users;
  const blocks = list.length
    ? list.map((n) => userBlock(n, st.users[n] || {}, now)).join('\n\n')
    : '<i>Chưa theo dõi ai. Dùng /add username</i>';
  return (
    `<b>📺 TikTok Live → TRMNL</b>\n\n${blocks}\n\n` +
    `━━━━━━━━━━━━\n⏱ Kiểm tra mỗi <b>${cfg.intervalMin} phút</b> · ` +
    `🖥 Quota trình duyệt hôm nay: <b>${budgetSec(st)}s</b> / ${cfg.browserDailySec}s`
  );
}

function settingsView(cfg) {
  const ints = [5, 10, 15, 30, 60];
  const text =
    `<b>⚙️ Cài đặt</b>\n\n` +
    `⏱ Kiểm tra mỗi: <b>${cfg.intervalMin} phút</b>\n` +
    `📸 Kiểu ảnh khi live: <b>${cfg.shotMode === 'screen' ? 'Chụp màn hình' : 'Ảnh cover'}</b>\n` +
    `   <i>• Chụp màn hình: đúng cảnh đang live, tốn quota trình duyệt (gói Free ~10 phút/ngày)\n` +
    `   • Ảnh cover: không tốn quota, nhưng là ảnh bìa phòng live</i>\n` +
    `🔔 Báo khi bắt đầu/kết thúc live: <b>${cfg.notify ? 'BẬT' : 'TẮT'}</b>`;
  const kb = [
    ints.map((n) => ({ text: (n === cfg.intervalMin ? '✅ ' : '') + n + "'", callback_data: 'int:' + n })),
    [
      { text: (cfg.shotMode === 'screen' ? '✅ ' : '') + '🖥 Màn hình', callback_data: 'mode:screen' },
      { text: (cfg.shotMode === 'cover' ? '✅ ' : '') + '🖼 Cover', callback_data: 'mode:cover' },
    ],
    [{ text: `🔔 Báo live: ${cfg.notify ? 'BẬT' : 'TẮT'}`, callback_data: 'notify' }],
    ...BACK_KB,
  ];
  return { text, kb };
}

function listView(cfg, st) {
  const rows = cfg.users.map((id, i) => {
    const I = idInfo(id);
    const u = st?.users?.[id] || {};
    const dot = u.unknown && Date.now() - (u.lastOkAt || 0) > 30 * 60000 ? '❓' : u.live ? '🔴' : '⚫';
    return `${i + 1}. ${dot} ${I.P.icon} <a href="${I.liveUrl}">${esc(I.display)}</a> · ${I.P.name}`;
  });
  const text =
    `<b>👥 Đang theo dõi (${cfg.users.length}/${MAX_USERS})</b>\n\n` +
    (rows.join('\n') || '<i>Trống</i>') +
    `\n\n🗑 Bấm <b>Xoá</b> cạnh tên để bỏ theo dõi.\n` +
    (cfg.users.length < MAX_USERS
      ? `➕ Thêm: <code>/add link</code> (TikTok / YouTube / Facebook) hoặc <code>/add yt tên</code> · <code>/add fb tên</code> · <code>/add tt tên</code>`
      : `<i>Đã đủ ${MAX_USERS} người — xoá bớt để thêm người mới.</i>`);
  const kb = [
    ...cfg.users.map((id) => {
      const I = idInfo(id);
      return [
        { text: `${I.P.icon} ${I.display}`, url: I.liveUrl },
        { text: '🗑 Xoá', callback_data: 'rmask:' + id },
      ];
    }),
    ...BACK_KB,
  ];
  return { text, kb };
}

function confirmRemoveView(id) {
  const I = idInfo(id);
  return {
    text: `🗑 Bỏ theo dõi ${I.P.icon} <b>${esc(I.display)}</b> (${I.P.name})?`,
    kb: [[
      { text: '✅ Xoá', callback_data: 'rm:' + id },
      { text: '↩️ Huỷ', callback_data: 'list' },
    ]],
  };
}

const HELP =
  `<b>❓ Hướng dẫn</b>\n\n` +
  `/status – ai đang live (kèm ảnh)\n` +
  `/shot – kiểm tra & chụp ngay (tất cả)\n` +
  `/shot tên – chụp riêng 1 người\n` +
  `/add link – thêm người (TikTok / YouTube / Facebook)\n` +
  `/add yt tên · /add fb tên · /add tt tên – gõ tắt\n` +
  `/remove tên – xoá người\n` +
  `/list – danh sách\n` +
  `/settings – tần suất, kiểu ảnh, thông báo\n` +
  `/preview – xem trước màn hình TRMNL (đúng như lần refresh tới)\n` +
  `/preview all – xem trước cả 4 cỡ (full, nửa ngang, nửa dọc, 1/4)\n` +
  `/trmnl – link Polling URL cho TRMNL\n` +
  `/update – cập nhật code mới nhất từ GitHub (chỉ khi bạn bấm)\n` +
  `/version – phiên bản đang chạy`;

async function sendLivePhotos(env, chatId, st, names) {
  for (const n of names) {
    const s = st.users[n];
    if (s && s.live && s.shotAt) {
      await sendPhotoFromKV(
        env, chatId, 'shot:' + n,
        `🔴 ${idInfo(n).P.icon} <b>${esc(idInfo(n).display)}</b>${s.viewers != null && s.viewers !== '' ? ` · 👁 ${s.viewers}` : ''} · 📸 ${fmtTime(s.shotAt)}`,
      );
    }
  }
}

async function doShot(env, chatId, only) {
  const wait = await sendMsg(env, chatId, `⏳ Đang kiểm tra${only ? ' ' + esc(idInfo(only).display) : ''} và chụp ảnh…`);
  const r = await runCheck(env, { force: true, only, forceShot: true });
  await editOrSend(env, chatId, wait?.result?.message_id, statusText(r.cfg, r.st, r.checked), MAIN_KB);
  await sendLivePhotos(env, chatId, r.st, r.checked);
}

const VIEW_NAME = {
  markup_full: 'Toàn màn hình',
  markup_half_horizontal: 'Nửa ngang',
  markup_half_vertical: 'Nửa dọc',
  markup_quadrant: '1/4 màn hình',
};

async function doPreview(env, chatId, all) {
  if (!env.TRMNL_MCP_KEY) {
    return sendMsg(env, chatId,
      '⚠️ Chưa có secret <code>TRMNL_MCP_KEY</code> (MCP API key của plugin trên TRMNL).\nThêm vào GitHub Secrets rồi bấm /update.');
  }
  const wait = await sendMsg(env, chatId, '⏳ Đang nhờ TRMNL render màn hình với dữ liệu hiện tại… (~15–30 giây)');
  const views = all
    ? ['markup_full', 'markup_half_horizontal', 'markup_half_vertical', 'markup_quadrant']
    : ['markup_full'];
  try {
    const imgs = await trmnlPreview(env, views);
    const cfg = await getConfig(env);
    const st = await getState(env);
    const lines = cfg.users.slice(0, MAX_USERS).map((id) => {
      const s = st.users[id] || {};
      const I = idInfo(id);
      const lf = s.unknown && Date.now() - (s.lastOkAt || 0) > 30 * 60000;
      return `${lf ? '❓' : s.live ? '🔴' : '⚫'} ${I.P.icon} <a href="${I.liveUrl}">${esc(I.display)}</a>`;
    });
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i];
      const cap = i === 0
        ? `🖼 <b>Preview TRMNL</b> · ${VIEW_NAME[im.view] || im.view}\n` +
          `<i>Đúng như màn hình sẽ hiện ở lần TRMNL refresh tới.</i>\n\n${lines.join('\n')}\n🕒 Dữ liệu lúc ${fmtTime(st.lastRun) || '?'}`
        : `🖼 ${VIEW_NAME[im.view] || im.view}`;
      await sendPhotoBytes(env, chatId, im.bytes, im.type, cap, i === imgs.length - 1 ? MAIN_KB : undefined);
    }
    if (wait?.result?.message_id) await tg(env, 'deleteMessage', { chat_id: chatId, message_id: wait.result.message_id });
  } catch (e) {
    await editOrSend(env, chatId, wait?.result?.message_id, `❌ Không lấy được preview.\n<code>${esc(e.message).slice(0, 500)}</code>`, MAIN_KB);
  }
}

// ---------- Thông báo tự động ----------
export async function notifyEvents(env, cfg, st, events) {
  const owner = env.TELEGRAM_OWNER_ID || cfg.ownerId;
  if (!env.TELEGRAM_BOT_TOKEN || !owner) return;
  const now = Date.now();
  for (const ev of events) {
    const I = idInfo(ev.id);
    const link = `${I.P.icon} <a href="${I.liveUrl}">${esc(I.display)}</a>`;
    if (ev.live) {
      const cap = `🔴 <b>${link} vừa LIVE trên ${I.P.name}!</b>${ev.title ? `\n📝 ${esc(ev.title)}` : ''}`;
      const sent = st.users[ev.id]?.shotAt ? await sendPhotoFromKV(env, owner, 'shot:' + ev.id, cap) : false;
      if (!sent) await sendMsg(env, owner, cap);
    } else {
      await sendMsg(env, owner, `⚫ ${link} đã tắt live${ev.liveSince ? ` (live ${fmtDur(now - ev.liveSince)})` : ''}`);
    }
  }
}

// ---------- Xử lý update ----------
export async function handleTelegram(req, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return new Response('no token', { status: 503 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await secretToken(env))) {
    return new Response('forbidden', { status: 403 });
  }
  const upd = await req.json();
  const origin = new URL(req.url).origin;

  // Chống xử lý trùng khi Telegram gửi lại
  const dk = 'upd:' + upd.update_id;
  if (await env.KV.get(dk)) return new Response('dup');

  try {
    await processUpdate(env, upd, origin, dk);
  } catch (e) {
    console.error('telegram', e);
  }
  return new Response('ok');
}

// Tìm id trong danh sách từ link / "yt tên" / tên trơn
function findId(cfg, arg) {
  const e = parseEntry(arg);
  if (e && cfg.users.includes(e.id)) return e.id;
  const h = String(arg || '').trim().replace(/^@/, '').toLowerCase();
  return cfg.users.find((id) => splitId(id).handle.toLowerCase() === (e ? e.handle.toLowerCase() : h)) || null;
}

async function processUpdate(env, upd, origin, dedupKey) {
  const cfg = await getConfig(env);
  const msg = upd.message;
  const cq = upd.callback_query;
  const from = (msg || cq)?.from;
  const chatId = msg ? msg.chat.id : cq?.message?.chat?.id;
  if (!from || !chatId) return;

  let owner = String(env.TELEGRAM_OWNER_ID || cfg.ownerId || '');
  const text = msg?.text || '';
  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].replace(/@.*$/, '').toLowerCase() : '';
  const arg = text.split(/\s+/).slice(1).join(' ').trim();

  // Người đầu tiên bấm /start trở thành chủ bot
  if (!owner && cmd === '/start') {
    cfg.ownerId = String(from.id);
    await saveConfig(env, cfg);
    owner = cfg.ownerId;
  }
  if (String(from.id) !== owner) {
    if (cq) await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Bot riêng tư' });
    else if (cmd === '/start') await sendMsg(env, chatId, '👋 Xin chào! Bot này là bot riêng tư.');
    return;
  }

  // ----- Nút bấm -----
  if (cq) {
    const data = cq.data || '';
    await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
    const msgId = cq.message?.message_id;
    if (data === 'menu') return editOrSend(env, chatId, msgId, welcome(cfg), MAIN_KB);
    if (data === 'status') {
      const st = await getState(env);
      await sendMsg(env, chatId, statusText(cfg, st), MAIN_KB);
      return sendLivePhotos(env, chatId, st, cfg.users);
    }
    if (data === 'shot') {
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      return doShot(env, chatId, null);
    }
    if (data === 'preview') {
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      return doPreview(env, chatId, false);
    }
    if (data === 'list') { const v = listView(cfg, await getState(env)); return editOrSend(env, chatId, msgId, v.text, v.kb); }
    if (data.startsWith('rmask:')) {
      const id = data.slice(6);
      if (!cfg.users.includes(id)) { const v = listView(cfg, await getState(env)); return editOrSend(env, chatId, msgId, v.text, v.kb); }
      const v = confirmRemoveView(id);
      return editOrSend(env, chatId, msgId, v.text, v.kb);
    }
    if (data === 'settings') { const v = settingsView(cfg); return editOrSend(env, chatId, msgId, v.text, v.kb); }
    if (data.startsWith('int:')) cfg.intervalMin = Number(data.slice(4));
    else if (data.startsWith('mode:')) cfg.shotMode = data.slice(5) === 'cover' ? 'cover' : 'screen';
    else if (data === 'notify') cfg.notify = !cfg.notify;
    else if (data.startsWith('rm:')) {
      const id = data.slice(3);
      cfg.users = cfg.users.filter((u) => u !== id);
      await saveConfig(env, cfg);
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: `Đã xoá ${idInfo(id).display}` }).catch(() => {});
      const v = listView(cfg, await getState(env));
      return editOrSend(env, chatId, msgId, `✅ Đã xoá ${idInfo(id).P.icon} <b>${esc(idInfo(id).display)}</b>\n\n` + v.text, v.kb);
    } else return;
    await saveConfig(env, cfg);
    const v = settingsView(cfg);
    return editOrSend(env, chatId, msgId, v.text, v.kb);
  }

  // ----- Lệnh -----
  switch (cmd) {
    case '/start':
    case '/menu':
      return sendMsg(env, chatId, welcome(cfg), MAIN_KB);
    case '/help':
      return sendMsg(env, chatId, HELP, MAIN_KB);
    case '/status': {
      const st = await getState(env);
      await sendMsg(env, chatId, statusText(cfg, st), MAIN_KB);
      return sendLivePhotos(env, chatId, st, cfg.users);
    }
    case '/shot': {
      let only = null;
      if (arg) {
        only = findId(cfg, arg);
        if (!only) return sendMsg(env, chatId, `⚠️ ${esc(arg)} không có trong danh sách. Xem /list`);
      }
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      return doShot(env, chatId, only);
    }
    case '/list': { const v = listView(cfg, await getState(env)); return sendMsg(env, chatId, v.text, v.kb); }
    case '/settings': { const v = settingsView(cfg); return sendMsg(env, chatId, v.text, v.kb); }
    case '/add': {
      const e = parseEntry(arg);
      if (!e) {
        return sendMsg(env, chatId,
          '⚠️ Cách dùng:\n<code>/add link TikTok / YouTube / Facebook</code>\n' +
          'hoặc <code>/add tt tên</code> · <code>/add yt tên</code> · <code>/add fb tên</code>');
      }
      const I = idInfo(e.id);
      if (cfg.users.includes(e.id)) return sendMsg(env, chatId, `ℹ️ ${I.P.icon} ${esc(I.display)} đã có trong danh sách.`);
      if (cfg.users.length >= MAX_USERS) {
        const v = listView(cfg, await getState(env));
        return sendMsg(env, chatId, `⚠️ Đã đủ <b>${MAX_USERS}</b> người (tối đa trên TRMNL). Xoá bớt 1 người rồi thêm lại nhé.\n\n` + v.text, v.kb);
      }
      cfg.users.push(e.id);
      await saveConfig(env, cfg);
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      let note = '';
      if (e.plat === 'fb' && !env.FACEBOOK_COOKIE) {
        note = '\n\n⚠️ <b>Facebook bắt đăng nhập</b> mới xem được trạng thái live. Cần thêm secret <code>FACEBOOK_COOKIE</code> trên GitHub (nên dùng tài khoản Facebook phụ). Chưa có thì sẽ hiện ❓.';
      }
      if (e.plat === 'yt') note = '\n\n<i>YouTube dùng ảnh thumbnail live (YouTube tự cập nhật vài phút/lần), không tốn quota trình duyệt.</i>';
      await sendMsg(env, chatId, `✅ Đã thêm ${I.P.icon} <b>${esc(I.display)}</b> (${I.P.name}). Đang kiểm tra…${note}`);
      return doShot(env, chatId, e.id);
    }
    case '/remove': {
      const id = arg ? findId(cfg, arg) : null;
      if (!id) {
        const v = listView(cfg, await getState(env));
        return sendMsg(env, chatId, '👇 Chọn người cần xoá:\n\n' + v.text, v.kb);
      }
      cfg.users = cfg.users.filter((x) => x !== id);
      await saveConfig(env, cfg);
      return sendMsg(env, chatId, `🗑 Đã xoá ${idInfo(id).P.icon} <b>${esc(idInfo(id).display)}</b>.`, MAIN_KB);
    }
    case '/preview':
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      return doPreview(env, chatId, /^(all|tat ca|tất cả)$/i.test(arg));
    case '/version':
      return sendMsg(env, chatId,
        `🏷 Phiên bản đang chạy: <code>${esc(env.VERSION || 'chưa rõ')}</code>\n📝 ${esc(env.VERSION_MSG || '')}`);
    case '/update': {
      if (!env.GH_TOKEN) {
        return sendMsg(env, chatId,
          '⚠️ Chưa có quyền cập nhật.\nThêm secret <code>GH_TOKEN</code> (GitHub token, quyền <b>Actions: Read and write</b> cho repo trmnl-live) rồi chạy <b>Deploy Worker</b> 1 lần trên GitHub.');
      }
      await env.KV.put(dedupKey, '1', { expirationTtl: 600 });
      const r = await fetch(`https://api.github.com/repos/${env.GH_REPO || 'meohocgioi/trmnl-live'}/actions/workflows/deploy.yml/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GH_TOKEN}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'trmnl-live-bot',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      if (r.status !== 204) {
        return sendMsg(env, chatId, `❌ Không gọi được GitHub (HTTP ${r.status}).\n<code>${esc((await r.text()).slice(0, 300))}</code>`);
      }
      return sendMsg(env, chatId,
        `🔄 <b>Đang cập nhật…</b>\nĐang chạy: <code>${esc(env.VERSION || '?')}</code>\nKhoảng 1 phút nữa bot sẽ báo ✅ khi xong.`);
    }
    case '/trmnl':
      return sendMsg(
        env, chatId,
        `<b>🖼 Cài đặt TRMNL</b>\n\nStrategy: <b>Polling</b>\nPolling URL:\n<code>${origin}/trmnl</code>`,
      );
    default:
      if (cmd) return sendMsg(env, chatId, '🤔 Không hiểu lệnh.\n\n' + HELP, MAIN_KB);
      // Dán link trực tiếp -> gợi ý thêm
      if (/(tiktok|youtube|facebook|fb)\.com\//i.test(text)) {
        const e = parseEntry(text);
        if (e) {
          return sendMsg(env, chatId, `Thêm ${idInfo(e.id).P.icon} ${esc(idInfo(e.id).display)}? Gõ <code>/add ${esc(text.trim())}</code>`);
        }
      }
  }
}

function welcome(cfg) {
  return (
    `<b>📺 TikTok Live → TRMNL</b>\n\n` +
    `Đang theo dõi <b>${cfg.users.length}</b> người · kiểm tra mỗi <b>${cfg.intervalMin} phút</b>.\n` +
    `Hỗ trợ 🎵 TikTok · ▶️ YouTube · 📘 Facebook.\nKhi ai đó live, màn hình TRMNL hiện ảnh phòng live; không live thì hiện <b>OFFLINE</b>.`
  );
}
