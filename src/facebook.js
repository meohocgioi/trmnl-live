// Kiểm tra live Facebook — THỬ NGHIỆM.
// Facebook bắt đăng nhập, nên cần secret FACEBOOK_COOKIE (cookie của 1 tài khoản Facebook, nên dùng tài khoản phụ).
import { UA } from './tiktok.js';
import { PLAT } from './platforms.js';

const unJson = (s) => {
  if (s == null) return null;
  try { return JSON.parse('"' + s + '"'); } catch { return s; }
};

const LIVE_MARKS = ['"is_live_streaming":true', '"broadcast_status":"LIVE"', '"is_live":true', '"isLiveNow":true'];

export async function checkLive(handle, env) {
  const out = {
    live: false, nickname: null, avatar: null, title: null, viewers: null,
    cover: null, videoUrl: null, error: null, source: null,
  };
  if (!env.FACEBOOK_COOKIE) {
    out.error = 'Facebook cần đăng nhập: thêm secret FACEBOOK_COOKIE trên GitHub';
    return out;
  }
  try {
    const r = await fetch(PLAT.fb.live(handle), {
      headers: {
        'user-agent': UA,
        'accept-language': 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        cookie: env.FACEBOOK_COOKIE,
      },
    });
    const h = await r.text();
    if (/\/login|checkpoint/.test(r.url) || r.status >= 400) {
      throw new Error(`HTTP ${r.status} — cookie Facebook hết hạn hoặc bị chặn`);
    }
    out.nickname =
      unJson((h.match(/"name":"([^"]{1,80})","profile_picture/) || [])[1]) ||
      (h.match(/<title[^>]*>([^<]*)/) || [])[1] ||
      handle;
    const pic = h.match(/"profilePic\w*":\{"uri":"([^"]+)"/) || h.match(/"profile_picture":\{"uri":"([^"]+)"/);
    if (pic) out.avatar = unJson(pic[1]);

    let at = -1;
    for (const mk of LIVE_MARKS) {
      const i = h.indexOf(mk);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) {
      out.live = true;
      const win = h.slice(Math.max(0, at - 4000), at + 4000);
      const vid = win.match(/\/videos\/(\d{6,})/) || win.match(/"(?:videoId|video_id)":"(\d{6,})"/);
      if (vid) out.videoUrl = `https://www.facebook.com/${handle}/videos/${vid[1]}`;
      const th = win.match(/"(?:preferred_thumbnail|thumbnailImage|image)":\{"uri":"([^"]+)"/);
      if (th) out.cover = unJson(th[1]);
      const tt = win.match(/"title":\{"text":"([^"]{1,200})"/);
      if (tt) out.title = unJson(tt[1]);
    }
    out.source = 'fb-page';
  } catch (e) {
    out.error = 'facebook: ' + e.message;
  }
  return out;
}
