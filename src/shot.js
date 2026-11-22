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
          // Gom cụm: video lớn nhất + các video khách mời nằm sát nó (bỏ video gợi ý ở chỗ khác)
          const rects = vids.map((v) => v.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height);
          let x1 = rects[0].left, y1 = rects[0].top, x2 = rects[0].right, y2 = rects[0].bottom;
          const used = new Set([0]);
          for (let changed = true; changed; ) {
            changed = false;
            rects.forEach((r, i) => {
              if (used.has(i)) return;
              const gap = 40;
              if (r.left <= x2 + gap && r.right >= x1 - gap && r.top <= y2 + gap && r.bottom >= y1 - gap) {
                x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
                x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
                used.add(i); changed = true;
              }
            });
          }
          x1 = Math.max(0, x1); y1 = Math.max(0, y1);
          return { x: x1 + scrollX, y: y1 + scrollY, width: x2 - x1, height: y2 - y1 };
        });
        if (!clip || clip.width < 60 || clip.height < 60) {
          results[t.id] = { error: 'không tìm thấy khung video' };
          continue;
        }
        await sleep(300);
        results[t.id] = { png: await page.screenshot({ type: 'png', clip }) };
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
