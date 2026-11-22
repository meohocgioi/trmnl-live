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
