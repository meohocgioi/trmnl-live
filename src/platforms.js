// Nền tảng hỗ trợ và cách nhận dạng link / username
// Mỗi người theo dõi có id dạng "<plat>-<handle>", ví dụ: tt-embechiiu_, yt-nasa, yt-UCxxxx, fb-nasa
export const PLAT = {
  tt: {
    name: 'TikTok',
    icon: '🎵',
    live: (h) => `https://www.tiktok.com/@${h}/live`,
    show: (h) => '@' + h,
  },
  yt: {
    name: 'YouTube',
    icon: '▶️',
    live: (h) => (isYtChannelId(h) ? `https://www.youtube.com/channel/${h}/live` : `https://www.youtube.com/@${h}/live`),
    show: (h) => (isYtChannelId(h) ? h : '@' + h),
  },
  fb: {
    name: 'Facebook',
    icon: '📘',
    live: (h) => `https://www.facebook.com/${h}/live_videos`,
    show: (h) => h,
  },
};

const ALIAS = { tt: 'tt', tiktok: 'tt', yt: 'yt', youtube: 'yt', fb: 'fb', facebook: 'fb' };
const isYtChannelId = (h) => /^UC[\w-]{22}$/.test(h);

export function splitId(id) {
  const i = id.indexOf('-');
  return { plat: id.slice(0, i), handle: id.slice(i + 1) };
}

export function idInfo(id) {
  const { plat, handle } = splitId(id);
  const P = PLAT[plat] || PLAT.tt;
  return { id, plat, handle, P, liveUrl: P.live(handle), display: P.show(handle) };
}

// Chuyển danh sách cũ (chỉ có username TikTok) sang dạng mới
export function migrateUsers(users) {
  return (users || []).map((u) => (/^(tt|yt|fb)-/.test(u) ? u : `tt-${u}`));
}

function clean(plat, h) {
  h = String(h || '').trim().replace(/^@/, '').split(/[/?#\s]/)[0];
  if (!h) return null;
  if (plat === 'yt' && isYtChannelId(h)) return h; // channel ID phân biệt hoa thường
  if (!/^[\w.\-]{2,64}$/.test(h)) return null;
  return h.toLowerCase();
}

/**
 * Nhận: link TikTok/YouTube/Facebook, "yt tên", "fb tên", "tt tên", "@tên" (mặc định TikTok)
 * Trả: { plat, handle, id } hoặc null
 */
export function parseEntry(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  let plat = null;
  let handle = null;

  const pre = s.match(/^(tt|tiktok|yt|youtube|fb|facebook)\s*[:\s]\s*(.+)$/i);
  if (pre && !/^https?:/i.test(s)) {
    plat = ALIAS[pre[1].toLowerCase()];
    s = pre[2].trim();
  }

  let m;
  if ((m = s.match(/tiktok\.com\/@([\w.]+)/i))) {
    plat = 'tt'; handle = m[1];
  } else if ((m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i))) {
    plat = 'yt'; handle = m[1];
  } else if ((m = s.match(/youtube\.com\/@([\w.\-]+)/i))) {
    plat = 'yt'; handle = m[1];
  } else if ((m = s.match(/youtube\.com\/(?:c|user)\/([\w.\-]+)/i))) {
    plat = 'yt'; handle = m[1];
  } else if ((m = s.match(/facebook\.com\/profile\.php\?(?:.*&)?id=(\d+)/i))) {
    plat = 'fb'; handle = m[1];
  } else if ((m = s.match(/(?:facebook|fb)\.com\/(?!watch|live|groups|events|profile\.php)([\w.\-]+)/i))) {
    plat = 'fb'; handle = m[1];
  } else if (/^https?:/i.test(s)) {
    return null;
  } else {
    handle = s;
    plat = plat || 'tt';
  }
  handle = clean(plat, handle);
  return handle ? { plat, handle, id: `${plat}-${handle}` } : null;
}
