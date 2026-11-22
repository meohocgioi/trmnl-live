// Thử: mở trang live TikTok, nghe dữ liệu chat (im/fetch + WebSocket) mà trang nhận về
import puppeteer from '@cloudflare/puppeteer';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function strs(b) {
  const out = []; let cur = [];
  const dec = new TextDecoder();
  for (const c of b) {
    if (c >= 0x20) cur.push(c);
    else { if (cur.length >= 3) out.push(dec.decode(new Uint8Array(cur))); cur = []; }
  }
  if (cur.length >= 3) out.push(dec.decode(new Uint8Array(cur)));
  return out;
}
async function gunzipAll(b) {
  // tìm các khối gzip trong gói protobuf và giải nén
  const res = [];
  for (let i = 0; i < b.length - 2; i++) {
    if (b[i] === 0x1f && b[i + 1] === 0x8b && b[i + 2] === 0x08) {
      try {
        const ds = new DecompressionStream('gzip');
        const w = ds.writable.getWriter(); w.write(b.slice(i)).catch(() => {}); w.close().catch(() => {});
        const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
        res.push(out); break;
      } catch {}
    }
  }
  return res;
}

export default {
  async fetch(req, env) {
    try { return await run(req, env); } catch (e) {
      return new Response(JSON.stringify({ error: String(e && e.stack || e) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  },
};

async function run(req, env) {
  {
    const u = new URL(req.url).searchParams.get('u') || 'quakhu.cuaanh';
    const wait = Number(new URL(req.url).searchParams.get('w') || 10000);
    const t0 = Date.now();
    const log = { http: [], ws: 0, wsBytes: 0, strings: [] };
    const bufs = [];
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1280, height: 900 });
      page.on('response', async (r) => {
        const url = r.url();
        if (/webcast\/im\/(fetch|push)/.test(url)) {
          try {
            const b = new Uint8Array(await r.buffer());
            log.http.push({ url: url.slice(0, 90), status: r.status(), len: b.length });
            bufs.push(b);
          } catch (e) { log.http.push({ url: url.slice(0, 90), err: String(e) }); }
        }
      });
      let cdp = null;
      try { cdp = await page.target().createCDPSession(); await cdp.send('Network.enable'); } catch (e) { log.cdpErr = String(e); }
      if (cdp) {
      cdp.on('Network.webSocketCreated', (e) => { log.wsUrl = (e.url || '').slice(0, 120); });
      cdp.on('Network.webSocketFrameReceived', (e) => {
        log.ws++;
        const p = e.response.payloadData || '';
        try {
          const b = e.response.opcode === 2 ? Uint8Array.from(atob(p), (c) => c.charCodeAt(0)) : new TextEncoder().encode(p);
          log.wsBytes += b.length; bufs.push(b);
        } catch {}
      });
      }
      await page.goto(`https://www.tiktok.com/@${u}/live`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await new Promise((r) => setTimeout(r, wait));
    } finally {
      await browser.close().catch(() => {});
    }
    const seen = new Set();
    for (const b of bufs) {
      for (const x of [b, ...(await gunzipAll(b))]) {
        for (const s of strs(x)) {
          if (/WebcastChatMessage|WebcastMemberMessage|WebcastGiftMessage|WebcastLikeMessage|WebcastSocialMessage/.test(s)) log.types = [...new Set([...(log.types || []), s.match(/Webcast\w+/)[0]])];
          if (s.length >= 2 && s.length < 200 && /[a-zA-ZÀ-ỹ]/.test(s) && !/^https?:|\.(png|webp|jpe?g)|~tplv|tos-|p\d+-|[A-Za-z0-9+/=_-]{30,}/.test(s) && !seen.has(s)) {
            seen.add(s); log.strings.push(s);
          }
        }
      }
    }
    log.strings = log.strings.slice(0, 150);
    log.ms = Date.now() - t0;
    return new Response(JSON.stringify(log, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
}
