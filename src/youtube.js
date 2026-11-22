// Kiểm tra live YouTube (không cần đăng nhập, không tốn quota trình duyệt)
import { UA } from './tiktok.js';
import { PLAT } from './platforms.js';

const between = (s, a, b, from = 0) => {
  const i = s.indexOf(a, from);
  if (i < 0) return null;
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? null : s.slice(i + a.length, j);
};

const unHtml = (s) =>
  s == null
    ? null
    : s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const unJson = (s) => {
  if (s == null) return null;
  try { return JSON.parse('"' + s + '"'); } catch { return s; }
};

const YT_HEADERS = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAI; CONSENT=YES+1' };
const isUC = (h) => /^UC[\w-]{22}$/.test(h);

// Đọc tab "Live/Streams" của kênh: video đầu tiên có nhãn LIVE = đang live
async function fromStreams(handle) {
  const url = isUC(handle) ? `https://www.youtube.com/channel/${handle}/streams` : `https://www.youtube.com/@${handle}/streams`;
  const r = await fetch(url, { headers: YT_HEADERS });
  if (!r.ok) throw new Error(`streams HTTP ${r.status}`);
  const h = await r.text();
  const out = { live: false, source: 'yt-streams' };
  out.nickname = unHtml(between(h, '<meta property="og:title" content="', '"'));
  const av = h.match(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[^"\\\s]+/);
  if (av) out.avatar = av[0].replace(/=s\d+-/, '=s240-');
  let at = -1;
  for (const m of ['BADGE_STYLE_TYPE_LIVE_NOW', '"style":"LIVE"', 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE']) {
    const i = h.indexOf(m);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return out;
  // Mã video: ngay sau nhãn LIVE (định dạng mới) hoặc trong link ảnh /vi/<id>/ phía trước
  let vid = (h.slice(at, at + 400).match(/"animationActivationTargetId":"([\w-]{11})"/) || [])[1];
  if (!vid) {
    const before = h.slice(Math.max(0, at - 3000), at);
    const ms = [...before.matchAll(/\/vi\/([\w-]{11})\//g), ...before.matchAll(/"(?:videoId|contentId)":"([\w-]{11})"/g)];
    vid = ms.length ? ms[ms.length - 1][1] : null;
  }
  if (!vid) return out;
  const win = h.slice(Math.max(0, at - 3000), at + 6000);
  out.live = true;
  out.videoId = vid;
  out.cover = `https://i.ytimg.com/vi/${vid}/maxresdefault_live.jpg`;
  const after = h.slice(at, at + 6000);
  out.title = unJson(between(after, '"title":{"content":"', '"')) || unJson(between(win, '"title":{"runs":[{"text":"', '"'));
  const vm = after.match(/"content":"([\d.,KMB]+) watching/) || win.match(/"text":"([\d.,KM]+)"\},\{"text":" watching/);
  if (vm) out.viewers = vm[1];
  return out;
}

export async function checkLive(handle, env) {
  try {
    return await fromStreams(handle);
  } catch (e) {
    const r = await checkLiveViaLivePage(handle, env);
    if (r.error) r.error += ' | ' + e.message;
    return r;
  }
}

async function checkLiveViaLivePage(handle, env) {
  const out = {
    live: false, nickname: null, avatar: null, title: null, viewers: null,
    cover: null, videoId: null, error: null, source: null,
  };
  try {
    const r = await fetch(isUC(handle) ? `https://www.youtube.com/channel/${handle}/live` : `https://www.youtube.com/@${handle}/live`, {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAI; CONSENT=YES+1' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 404 ? ' (không thấy kênh)' : ''}`);
    const h = await r.text();

    const canonical = between(h, '<link rel="canonical" href="', '"') || '';
    let vid = (canonical.match(/watch\?v=([\w-]{11})/) || [])[1] || null;

    if (vid) {
      // /live chuyển sang trang video -> đang live hoặc sắp live
      out.live = h.includes('"isLiveNow":true');
      out.upcoming = !out.live && h.includes('"isUpcoming":true');
      out.title = unHtml(between(h, '<meta property="og:title" content="', '"'));
      out.nickname = unJson(between(h, '"ownerChannelName":"', '"')) || unJson(between(h, '"author":"', '"'));
    } else {
      // Trang kênh (không live) — hoặc bố cục khác: tìm video đang có người xem
      out.nickname = unHtml(between(h, '<meta property="og:title" content="', '"'));
      const w = h.indexOf(' watching now');
      const liveMark = h.indexOf('"isLive":true');
      const at = w >= 0 ? w : liveMark;
      if (at >= 0) {
        const k = h.lastIndexOf('"videoId":"', at);
        if (k >= 0) vid = h.slice(k + 11, k + 22);
        out.live = !!vid;
        out.title = unJson(between(h, '"title":{"runs":[{"text":"', '"', k >= 0 ? k : 0));
      }
    }

    const vm = h.match(/"text":"([\d.,KM]+)"\},\{"text":" watching now"/);
    if (vm) out.viewers = vm[1];
    const av = h.match(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[^"\\\s]+/);
    if (av) out.avatar = av[0].replace(/=s\d+-/, '=s240-');
    out.videoId = vid;
    if (vid) out.cover = `https://i.ytimg.com/vi/${vid}/maxresdefault_live.jpg`;
    out.source = 'yt-page';
  } catch (e) {
    out.error = 'youtube: ' + e.message;
  }
  return out;
}
