// Lưu trữ trong Cloudflare KV
import { migrateUsers } from './platforms.js';

export const MAX_USERS = 4; // TRMNL hiện tối đa 4 người

export const DEFAULT_CONFIG = {
  users: ['tt-embechiiu_', 'tt-ducnguyen37999'], // id dạng <tt|yt|fb>-<handle>
  intervalMin: 10,        // bao lâu kiểm tra 1 lần (phút)
  shotMode: 'screen',     // 'screen' = chụp màn hình live bằng trình duyệt, 'cover' = ảnh cover phòng live
  notify: true,           // báo Telegram khi ai đó bắt đầu / kết thúc live
  plan: 'paid',           // gói Cloudflare Workers: 'paid' (10 giờ trình duyệt/tháng, vượt 0,09 USD/giờ) | 'free' (10 phút/ngày)
  browserDailySec: 2400,  // trần trình duyệt tự đặt mỗi ngày (paid: 40 phút ≈ tối đa ~1 USD/tháng phụ trội; free: 540)
  ownerId: null,
  flags: {},              // { id: { screen: bool, status: bool } }
};

// Cờ hiển thị của từng người (mặc định bật cả Screen và Status)
export function flagsOf(cfg, id) {
  return { screen: true, status: true, ...((cfg.flags || {})[id] || {}) };
}

export async function getConfig(env) {
  const c = await env.KV.get('config', 'json');
  const cfg = { ...DEFAULT_CONFIG, ...(c || {}) };
  cfg.users = migrateUsers(cfg.users);
  if (!c || !c.plan) { cfg.plan = DEFAULT_CONFIG.plan; cfg.browserDailySec = DEFAULT_CONFIG.browserDailySec; }
  return cfg;
}

export async function saveConfig(env, cfg) {
  await env.KV.put('config', JSON.stringify(cfg));
}

export async function getState(env) {
  const s = await env.KV.get('state', 'json');
  return { lastRun: 0, users: {}, budget: { day: '', ms: 0 }, ...(s || {}) };
}

export async function saveState(env, st) {
  await env.KV.put('state', JSON.stringify(st));
}

export async function putImage(env, key, bytes, type) {
  await env.KV.put('img:' + key, bytes, { metadata: { type } });
}

export async function getImage(env, key) {
  return env.KV.getWithMetadata('img:' + key, 'arrayBuffer');
}

// Lịch sử các lần TRMNL lấy dữ liệu (/trmnl) → đoán lần refresh tới để chụp ảnh ngay trước đó
export async function getPolls(env) {
  return (await env.KV.get('polls', 'json')) || [];
}
export async function recordPoll(env, now = Date.now()) {
  const p = await getPolls(env);
  if (p.length && now - p[p.length - 1] < 60000) return; // trùng lặp trong 1 phút
  p.push(now);
  await env.KV.put('polls', JSON.stringify(p.slice(-12)));
}
// { interval, last, next } (ms) hoặc null nếu chưa đủ dữ liệu
export function pollSchedule(polls) {
  if (!polls || polls.length < 2) return null;
  const d = [];
  for (let i = 1; i < polls.length; i++) {
    const x = polls[i] - polls[i - 1];
    if (x >= 4 * 60000 && x <= 70 * 60000) d.push(x);
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  const interval = d[d.length >> 1];
  const last = polls[polls.length - 1];
  let next = last + interval;
  const now = Date.now();
  while (next < now - 3 * 60000) next += interval; // bỏ lỡ vài lượt (TRMNL ngủ) → nhảy tới lượt kế
  return { interval, last, next };
}
