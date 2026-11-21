// Chụp màn hình phòng live bằng Cloudflare Browser Rendering
import puppeteer from '@cloudflare/puppeteer';
import { UA } from './tiktok.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCookies(str) {
  return String(str || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.includes('='))
    .map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i), value: p.slice(i + 1), domain: '.tiktok.com', path: '/' };
    });
}

// Chụp nhiều user trong 1 lần mở trình duyệt (tiết kiệm quota)
export async function screenshotLives(env, users) {
  const results = {};
  const t0 = Date.now();
  if (!users.length) return { results, ms: 0 };
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    for (const u of users) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1280, height: 900 });
        const cookies = parseCookies(env.TIKTOK_COOKIE);
        if (cookies.length) await page.setCookie(...cookies);
        await page.goto(`https://www.tiktok.com/@${u}/live`, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });
        // Đợi video thật sự có hình
        const ok = await page
          .waitForFunction(
            () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.readyState >= 2),
            { timeout: 15000, polling: 500 },
          )
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          results[u] = { error: 'video không phát được (TikTok chặn / cần đăng nhập / chưa có hình)' };
          continue;
        }
        await page.keyboard.press('Escape').catch(() => {}); // đóng popup đăng nhập nếu có
        await sleep(1500);
        const handle = await page.evaluateHandle(() => {
          const vs = [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0);
          vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
          return vs[0] || null;
        });
        const el = handle.asElement();
        if (!el) {
          results[u] = { error: 'không tìm thấy khung video' };
          continue;
        }
        const png = await el.screenshot({ type: 'png' });
        results[u] = { png };
      } catch (e) {
        results[u] = { error: e.message };
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    for (const u of users) if (!results[u]) results[u] = { error: 'trình duyệt: ' + e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return { results, ms: Date.now() - t0 };
}
