// Chụp màn hình phòng live bằng Cloudflare Browser Rendering
import puppeteer from '@cloudflare/puppeteer';
import { UA } from './tiktok.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCookies(str, domain) {
  return String(str || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.includes('='))
    .map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i), value: p.slice(i + 1), domain, path: '/' };
    });
}

/**
 * Chụp nhiều trang trong 1 lần mở trình duyệt (tiết kiệm quota)
 * targets: [{ id, url, cookie, domain }]
 */
export async function screenshotTargets(env, targets) {
  const results = {};
  const t0 = Date.now();
  if (!targets.length) return { results, ms: 0 };
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    for (const t of targets) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1280, height: 900 });
        const cookies = parseCookies(t.cookie, t.domain);
        if (cookies.length) await page.setCookie(...cookies);
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        const ok = await page
          .waitForFunction(
            () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.readyState >= 2),
            { timeout: 15000, polling: 500 },
          )
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          results[t.id] = { error: 'video không phát được (bị chặn / cần đăng nhập / chưa có hình)' };
          continue;
        }
        await page.keyboard.press('Escape').catch(() => {}); // đóng popup đăng nhập nếu có
        await sleep(1500);
        // Ẩn popup/banner che video (cookie, đăng nhập, menu cố định) rồi tính khung chứa tất cả video
        const clip = await page.evaluate(() => {
          const vids = [...document.querySelectorAll('video')].filter((v) => {
            const r = v.getBoundingClientRect();
            return v.videoWidth > 0 && r.width > 60 && r.height > 60;
          });
          if (!vids.length) return null;
          const keep = new Set();
          for (const v of vids) for (let e = v; e; e = e.parentElement) keep.add(e);
          const hide = (el) => el.style.setProperty('visibility', 'hidden', 'important');
          document
            .querySelectorAll('tiktok-cookie-banner, [class*="cookie" i], [id*="cookie" i], [role="dialog"], [aria-modal="true"]')
            .forEach((el) => { if (!keep.has(el)) el.style.setProperty('display', 'none', 'important'); });
          for (const el of document.querySelectorAll('body *')) {
            if (keep.has(el)) continue;
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') hide(el);
          }
          // Vùng hình thật của video (bỏ viền đen do object-fit: contain)
          const content = (v) => {
            const r = v.getBoundingClientRect();
            const fit = getComputedStyle(v).objectFit;
            if (fit === 'cover' || fit === 'fill' || !v.videoWidth || !v.videoHeight) return r;
            const sc = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
            const w = v.videoWidth * sc, h = v.videoHeight * sc;
            const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2;
            return { left, top, right: left + w, bottom: top + h, width: w, height: h };
          };
          const rects = vids.map(content).sort((a, b) => b.width * b.height - a.width * a.height);
          // Chỉ lấy video chính (lớn nhất) — bỏ video gợi ý phòng khác
          const main = rects[0];
          let x1 = main.left, y1 = main.top, x2 = main.right, y2 = main.bottom;
          // Ẩn mọi lớp phủ nằm đè lên video (tên/nút Follow, thông báo đăng nhập, quà tặng…)
          for (const el of document.querySelectorAll('body *')) {
            if (keep.has(el) || el.tagName === 'VIDEO') continue;
            const pos = getComputedStyle(el).position;
            if (pos !== 'absolute' && pos !== 'fixed' && pos !== 'sticky') continue;
            const r = el.getBoundingClientRect();
            if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) hide(el);
          }
          x1 = Math.max(0, x1); y1 = Math.max(0, y1);
          return { x: x1 + scrollX, y: y1 + scrollY, width: x2 - x1, height: y2 - y1 };
        });
        if (!clip || clip.width < 60 || clip.height < 60) {
          results[t.id] = { error: 'không tìm thấy khung video' };
          continue;
        }
        await sleep(300);
        let png = await page.screenshot({ type: 'png', clip });
        // Cắt bỏ dải đen trên/dưới/2 bên có sẵn trong luồng video
        try {
          const b64 = Buffer.from(png).toString('base64');
          const trimmed = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await img.decode();
            const W = img.width, H = img.height;
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, W, H).data;
            // Hàng/cột "trơn" = gần như cùng một màu (dải đen, nền trắng, viền) -> cắt bỏ
            const flat = (n, at) => {
              const v = [];
              for (let i = 0; i < n; i += 3) { const p = at(i) * 4; v.push((d[p] + d[p + 1] + d[p + 2]) / 3); }
              const s = [...v].sort((a, b) => a - b), med = s[s.length >> 1];
              return v.filter((x) => Math.abs(x - med) < 28).length >= v.length * 0.94;
            };
            const row = (y) => flat(W, (x) => y * W + x);
            const col = (x) => flat(H, (y) => y * W + x);
            let t = 0, b = H - 1, l = 0, r = W - 1;
            while (t < b && row(t)) t++;
            while (b > t && row(b)) b--;
            while (l < r && col(l)) l++;
            while (r > l && col(r)) r--;
            if (b - t < H * 0.25 || r - l < W * 0.25) return null;
            if (t < 3 && b > H - 4 && l < 3 && r > W - 4) return null;
            const o = document.createElement('canvas');
            o.width = r - l + 1; o.height = b - t + 1;
            o.getContext('2d').drawImage(c, l, t, o.width, o.height, 0, 0, o.width, o.height);
            return o.toDataURL('image/png').split(',')[1];
          }, b64);
          if (trimmed) png = Buffer.from(trimmed, 'base64');
        } catch {}
        results[t.id] = { png };
      } catch (e) {
        results[t.id] = { error: e.message };
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    for (const t of targets) if (!results[t.id]) results[t.id] = { error: 'trình duyệt: ' + e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { results, ms: Date.now() - t0 };
}
