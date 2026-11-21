// Kiểm tra trạng thái live của 1 user TikTok (không dùng trình duyệt -> không tốn quota)
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function headers(env, extra = {}) {
  const h = {
    'user-agent': UA,
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    referer: 'https://www.tiktok.com/',
    ...extra,
  };
  if (env.TIKTOK_COOKIE) h.cookie = env.TIKTOK_COOKIE;
  return h;
}

// Nhận "@abc", "abc", hoặc link https://www.tiktok.com/@abc/live -> "abc"
export function normUser(s) {
  s = String(s || '').trim();
  const m = s.match(/tiktok\.com\/@([\w.]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').split(/[/?#\s]/)[0];
  return /^[\w.]{2,32}$/.test(s) ? s.toLowerCase() : null;
}

async function getJSON(url, env) {
  const r = await fetch(url, { headers: headers(env, { accept: 'application/json' }) });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`HTTP ${r.status}, không phải JSON`);
  }
}

export async function checkLive(user, env) {
  const out = {
    user, live: false, roomId: null, nickname: null, avatar: null,
    title: null, viewers: null, cover: null, error: null, source: null,
  };
  const errs = [];

  // 1) API web của TikTok
  try {
    const j = await getJSON(
      'https://www.tiktok.com/api-live/user/room/?aid=1988&app_language=en&app_name=tiktok_web' +
        `&device_platform=web_pc&sourceType=54&uniqueId=${encodeURIComponent(user)}`,
      env,
    );
    const d = j && j.data;
    if (d && d.user) {
      const lr = d.liveRoom || {};
      out.roomId = d.user.roomId || null;
      out.nickname = d.user.nickname || null;
      out.avatar = d.user.avatarLarger || d.user.avatarMedium || d.user.avatarThumb || null;
      out.raw = { userStatus: d.user.status, liveRoomStatus: lr.status, startTime: lr.startTime };
      out.live = (lr.status ?? d.user.status) === 2;
      out.title = lr.title || null;
      out.viewers = lr.liveRoomStats?.userCount ?? null;
      out.cover = lr.coverUrl || null;
      out.source = 'api-live';
    } else {
      errs.push('api-live: ' + (j?.message || `statusCode ${j?.statusCode}`));
    }
  } catch (e) {
    errs.push('api-live: ' + e.message);
  }

  // 2) Dự phòng: đọc roomId từ trang /live
  if (!out.source) {
    try {
      const r = await fetch(`https://www.tiktok.com/@${user}/live`, {
        headers: headers(env, { accept: 'text/html' }),
      });
      const html = await r.text();
      const m = html.match(/"roomId":"(\d+)"/);
      if (m) {
        out.roomId = m[1];
        out.source = 'html';
      } else {
        errs.push(`html: HTTP ${r.status}, không thấy roomId`);
      }
    } catch (e) {
      errs.push('html: ' + e.message);
    }
  }

  // 3) Xác nhận bằng thông tin phòng live
  if (out.roomId && out.roomId !== '0') {
    try {
      const j = await getJSON(
        `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${out.roomId}`,
        env,
      );
      const d = j && j.data;
      out.raw = { ...(out.raw || {}), roomStatus: d?.status, roomStatusCode: j?.status_code, roomMsg: d?.message || j?.data?.prompts };
      if (d && d.status !== undefined) {
        out.live = d.status === 2;
        out.title = d.title || out.title;
        out.viewers = d.user_count ?? out.viewers;
        out.cover = d.cover?.url_list?.[0] || out.cover;
        out.nickname = d.owner?.nickname || out.nickname;
        out.avatar = d.owner?.avatar_large?.url_list?.[0] || out.avatar;
        out.source += '+room';
      }
    } catch (e) {
      errs.push('room: ' + e.message);
    }
  }

  if (!out.source) out.error = errs.join(' | ');
  return out;
}
