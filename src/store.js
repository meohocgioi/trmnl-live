// Lưu trữ trong Cloudflare KV
import { migrateUsers } from './platforms.js';

export const MAX_USERS = 4; // TRMNL hiện tối đa 4 người

export const DEFAULT_CONFIG = {
  users: ['tt-embechiiu_', 'tt-ducnguyen37999'], // id dạng <tt|yt|fb>-<handle>
  intervalMin: 10,        // bao lâu kiểm tra 1 lần (phút)
  shotMode: 'screen',     // 'screen' = chụp màn hình live bằng trình duyệt, 'cover' = ảnh cover phòng live
  notify: true,           // báo Telegram khi ai đó bắt đầu / kết thúc live
  browserDailySec: 540,   // quota trình duyệt tự đặt mỗi ngày (gói Free = 600s)
  ownerId: null,
};

export async function getConfig(env) {
  const c = await env.KV.get('config', 'json');
  const cfg = { ...DEFAULT_CONFIG, ...(c || {}) };
  cfg.users = migrateUsers(cfg.users);
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
