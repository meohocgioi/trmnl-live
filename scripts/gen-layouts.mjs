// Tính trước MỌI trường hợp collage (chạy 1 lần trên máy/CI, Worker chỉ việc tra bảng → 0 ms CPU).
// node scripts/gen-layouts.mjs  → ghi src/layouts.json
import { writeFileSync } from 'node:fs';
import { BUCKETS, W, H_FULL, GAP, HEAD, SB_BOTTOM, offNeed, offAr, keyOf } from '../src/layout-const.js';

const STEP = 0.025;
const RATIOS = [];
for (let r = 0.12; r <= 0.881; r += STEP) RATIOS.push(+r.toFixed(3));
const WASTE_K = Number(process.env.WASTE_K || 0.8);
const SIDE_WIDTHS = [176, 210, 250, 290, 330, 370, 410];

function fitArea(ar, w, h) {
  const ih = Math.max(1, h - HEAD);
  const sw = Math.min(w, ih * ar);
  return Math.max(1, sw * (sw / ar));
}
function leafScore(it, w, h) {
  if (it.off) {
    const need = it.need, a = w * h;
    let s = 0.8 * Math.log(Math.max(0.05, Math.min(a, need) / need)) - (a > need * 3 ? 0.1 * Math.log(a / (need * 3)) : 0);
    if (w < 150 || h < 56) s -= 3;
    return s;
  }
  const a = fitArea(it.ar, w, h);
  // khoảng trắng thừa bên trong ô live bị trừ điểm → chỗ dư nhường cho ô offline / cột status
  const waste = Math.max(0, w * h - a - w * HEAD);
  let s = Math.log(a) + 1.5 * (a / (W * H_FULL)) - WASTE_K * (waste / (W * H_FULL));
  if (w < 110 || h < 90) s -= 3;
  return s;
}

// cây chia (không lặp đối xứng); ô offline luôn nằm nhánh sau (phải/dưới)
// quan hệ tuyến tính của mỗi cây con: rộng tự nhiên = m * cao + d (đã tính thanh tiêu đề)
const leafLin = (it) => (it.off ? { m: it.ar, d: 0 } : { m: it.ar, d: -it.ar * HEAD });
const vLin = (a, b) => ({ m: a.m + b.m, d: a.d + b.d + GAP });
function hLin(a, b) {
  const m = 1 / (1 / a.m + 1 / b.m);
  return { m, d: m * (a.d / a.m + b.d / b.m - GAP) };
}

function trees(items) {
  if (items.length === 1) return [{ leaf: items[0], lin: leafLin(items[0]) }];
  const out = [];
  const n = items.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    if (!(mask & 1)) continue; // phần tử 0 luôn ở nhánh A → bỏ trùng gương
    let A = items.filter((_, k) => mask & (1 << k));
    let B = items.filter((_, k) => !(mask & (1 << k)));
    if (A.some((x) => x.off)) [A, B] = [B, A];
    for (const a of trees(A)) for (const b of trees(B)) {
      out.push({ dir: 'v', a, b, lin: vLin(a.lin, b.lin) });
      out.push({ dir: 'h', a, b, lin: hLin(a.lin, b.lin) });
    }
  }
  return out;
}

// tối ưu tỉ lệ chia: điểm là tổng theo từng ô → tối ưu từng nhánh độc lập
function solve(t, w, h) {
  if (t.leaf) return { s: leafScore(t.leaf, w, h), plan: { leaf: t.leaf } };
  let best = null;
  // tỉ lệ "tự nhiên" (ảnh khít nhau) thử trước; hoà điểm thì giữ cái gần tự nhiên nhất → ô cân đối
  let nat;
  if (t.dir === 'v') {
    const wa = Math.max(1, t.a.lin.m * h + t.a.lin.d), wb = Math.max(1, t.b.lin.m * h + t.b.lin.d);
    nat = wa / (wa + wb);
  } else {
    const ha = Math.max(1, (w - t.a.lin.d) / t.a.lin.m), hb = Math.max(1, (w - t.b.lin.d) / t.b.lin.m);
    nat = ha / (ha + hb);
  }
  nat = Math.min(0.88, Math.max(0.12, nat));
  const cand = [nat, ...RATIOS].sort((x, y) => Math.abs(x - nat) - Math.abs(y - nat));
  for (const r of cand) {
    let A, B;
    if (t.dir === 'v') {
      const w1 = (w - GAP) * r;
      if (w1 < 60 || w - GAP - w1 < 60) continue;
      A = solve(t.a, w1, h); B = solve(t.b, w - GAP - w1, h);
    } else {
      const h1 = (h - GAP) * r;
      if (h1 < 50 || h - GAP - h1 < 50) continue;
      A = solve(t.a, w, h1); B = solve(t.b, w, h - GAP - h1);
    }
    const s = A.s + B.s;
    if (!best || s > best.s + 1e-6) best = { s, plan: { dir: t.dir, r, a: A.plan, b: B.plan } };
  }
  return best || { s: -1e9, plan: null };
}

function place(p, r, cells) {
  if (p.leaf) return cells.push({ item: p.leaf, x: r.x, y: r.y, w: r.w, h: r.h });
  if (p.dir === 'v') {
    const w1 = (r.w - GAP) * p.r;
    place(p.a, { x: r.x, y: r.y, w: w1, h: r.h }, cells);
    place(p.b, { x: r.x + w1 + GAP, y: r.y, w: r.w - GAP - w1, h: r.h }, cells);
  } else {
    const h1 = (r.h - GAP) * p.r;
    place(p.a, { x: r.x, y: r.y, w: r.w, h: h1 }, cells);
    place(p.b, { x: r.x, y: r.y + h1 + GAP, w: r.w, h: r.h - GAP - h1 }, cells);
  }
}

const pct = (v, t) => Math.round((v / t) * 1000) / 10;

function compute(ars, offCount, hasStatus) {
  const items = ars.map((ar, k) => ({ ar, k }));
  if (offCount) items.push({ off: true, k: -1, need: offNeed(offCount), ar: offAr(offCount) });
  const opts = !hasStatus
    ? [{ sb: null, sw: 0, w: W, h: H_FULL, bonus: 0 }]
    : [{ sb: 'bottom', sw: 0, w: W, h: H_FULL - SB_BOTTOM, bonus: 0.12 },
       ...SIDE_WIDTHS.map((sw) => ({ sb: 'side', sw, w: W - sw - GAP, h: H_FULL, bonus: 0.25 * (sw / W) }))];
  let pick = null;
  const ts = trees(items);
  for (const o of opts) for (const t of ts) {
    const r = solve(t, o.w, o.h);
    const s = r.s + o.bonus;
    if (!pick || s > pick.s + 1e-9) pick = { s, plan: r.plan, o };
  }
  const cells = [];
  place(pick.plan, { x: 0, y: 0, w: pick.o.w, h: pick.o.h }, cells);
  const { w: AW, h: AH } = pick.o;
  let used = 0;
  for (const c of cells) if (!c.item.off) used += fitArea(c.item.ar, c.w, c.h);
  const oc = cells.find((c) => c.item.off);
  return {
    sb: pick.o.sb,
    sw: pick.o.sw ? pct(pick.o.sw + GAP, W) : 0,
    fill: Math.round((used / (W * H_FULL)) * 100),
    c: cells.filter((c) => !c.item.off).map((c) => [c.item.k, pct(c.x, AW), pct(c.y, AH), pct(c.w, AW), pct(c.h, AH), c.w < 230 || c.h < 160 ? 's' : c.w < 380 ? 'm' : 'l']),
    o: oc ? [pct(oc.x, AW), pct(oc.y, AH), pct(oc.w, AW), pct(oc.h, AH),
      offCount > 1 && oc.w / oc.h > 2.2 ? 'row' : offCount > 2 && oc.w > 330 && oc.h > 220 ? 'grid' : 'col'] : null,
  };
}

function multisets(k, start = 0) {
  if (k === 0) return [[]];
  const out = [];
  for (let b = start; b < BUCKETS.length; b++) for (const rest of multisets(k - 1, b)) out.push([b, ...rest]);
  return out;
}

const t0 = Date.now();
const table = {};
for (let k = 1; k <= 4; k++) {
  for (const ms of multisets(k)) {
    for (let off = 0; off <= 4 - k; off++) {
      for (const st of [0, 1]) {
        table[keyOf(ms, off, st)] = compute(ms.map((b) => BUCKETS[b]), off, st);
      }
    }
  }
}
writeFileSync(new URL('../src/layouts.json', import.meta.url), JSON.stringify(table));
console.log(Object.keys(table).length, 'layouts in', (Date.now() - t0) / 1000, 's');
