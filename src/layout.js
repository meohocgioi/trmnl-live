// Tự tính bố cục collage cho TRMNL.
// Thử mọi cách chia màn hình (cạnh nhau / chồng nhau, lồng nhau), kích thước chia theo tỉ lệ ảnh.
// Tiêu chí CÂN BẰNG: tổng log(diện tích hình) — để không ai bị bé tí; ô offline cũng nằm trong collage.
const W = 780; // vùng nội dung xấp xỉ (px) của TRMNL 800x480
const H_FULL = 452;
const STATUS_H = 42; // chiều cao thanh trạng thái + khoảng cách
let H = H_FULL;
const GAP = 8;
const HEAD = 28; // thanh tiêu đề mỗi ô live

function fitArea(ar, w, h, head) {
  const ih = Math.max(1, h - head);
  const sw = Math.min(w, ih * ar);
  return Math.max(1, sw * (sw / ar));
}

function trees(items, root = true) {
  if (items.length === 1) return [{ leaf: items[0], ar: items[0].ar }];
  const out = [];
  const n = items.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const A = items.filter((_, k) => mask & (1 << k));
    const B = items.filter((_, k) => !(mask & (1 << k)));
    const TA = trees(A, false), TB = trees(B, false);
    for (const a of TA) for (const b of TB) {
      // mỗi nút: chia theo tỉ lệ ảnh (half=false) hoặc chia đôi đều (half=true)
      for (const half of root || items.length <= 2 ? [false, true] : [false]) {
        out.push({ dir: 'v', a, b, half, ar: half ? 2 * Math.min(a.ar, b.ar) : a.ar + b.ar });
        out.push({ dir: 'h', a, b, half, ar: half ? Math.min(a.ar, b.ar) / 2 : 1 / (1 / a.ar + 1 / b.ar) });
      }
    }
  }
  return out;
}

const clamp = (t) => Math.min(0.8, Math.max(0.2, t));

function place(t, r, cells) {
  if (t.leaf) {
    cells.push({ item: t.leaf, x: r.x, y: r.y, w: r.w, h: r.h });
    return;
  }
  if (t.dir === 'v') {
    const w1 = (r.w - GAP) * (t.half ? 0.5 : clamp(t.a.ar / (t.a.ar + t.b.ar)));
    place(t.a, { x: r.x, y: r.y, w: w1, h: r.h }, cells);
    place(t.b, { x: r.x + w1 + GAP, y: r.y, w: r.w - GAP - w1, h: r.h }, cells);
  } else {
    const ia = 1 / t.a.ar, ib = 1 / t.b.ar;
    const h1 = (r.h - GAP) * (t.half ? 0.5 : clamp(ia / (ia + ib)));
    place(t.a, { x: r.x, y: r.y, w: r.w, h: h1 }, cells);
    place(t.b, { x: r.x, y: r.y + h1 + GAP, w: r.w, h: r.h - GAP - h1 }, cells);
  }
}

function score(cells) {
  let s = 0, used = 0;
  for (const c of cells) {
    if (c.item.off) {
      // ô offline: chỉ cần đủ chỗ; to quá thì bị trừ điểm (nhường chỗ cho live)
      const need = c.item.need;
      const a = c.w * c.h;
      s += 0.8 * Math.log(Math.max(0.05, Math.min(a, need) / need)) - (a > need * 1.8 ? 0.6 * Math.log(a / (need * 1.8)) : 0);
      if (c.w < 150 || c.h < 56) s -= 3;
    } else {
      const a = fitArea(c.item.ar, c.w, c.h, HEAD);
      used += a;
      s += Math.log(a);
      if (c.w < 110 || c.h < 90) s -= 3;
    }
  }
  return s + 1.2 * (used / (W * H)); // thưởng thêm khi ít khoảng trắng
}

const pct = (v, total) => Math.round((v / total) * 10000) / 100;

/**
 * live: [{ i, ar }]  (i = vị trí trong mảng users)
 * offCount: số người offline cần hiện
 * Trả: { cells:[{i,x,y,w,h,size}], off:{x,y,w,h,dir} | null }  (đơn vị %)
 */
export function computeLayout(live, offCount, hasStatus = false) {
  if (!live.length) return null;
  H = hasStatus ? H_FULL - STATUS_H : H_FULL;
  const items = live.map((l) => ({ ...l }));
  if (offCount > 0) {
    // khối offline: k ô nhỏ (mỗi ô ~ 190x70)
    const off = { off: true, i: -1 };
    off.need = offCount * 190 * 70;
    off.ar = offCount === 1 ? 2.8 : offCount === 2 ? 1.4 : 0.9;
    items.push(off);
  }
  let pick = null;
  for (const t of trees(items)) {
    const cells = [];
    place(t, { x: 0, y: 0, w: W, h: H }, cells);
    const s = score(cells);
    if (!pick || s > pick.s) pick = { s, cells };
  }

  const cells = pick.cells;
  const offCell = cells.find((c) => c.item.off);
  return {
    cells: cells.filter((c) => !c.item.off).map((c) => ({
      i: c.item.i,
      x: pct(c.x, W), y: pct(c.y, H), w: pct(c.w, W), h: pct(c.h, H),
      size: c.w < 230 || c.h < 160 ? 's' : c.w < 380 ? 'm' : 'l',
    })),
    off: offCell
      ? {
          x: pct(offCell.x, W), y: pct(offCell.y, H), w: pct(offCell.w, W), h: pct(offCell.h, H),
          dir: offCount > 1 && offCell.w / offCell.h > 2.2 ? 'row' : offCount > 2 && offCell.w > 330 && offCell.h > 220 ? 'grid' : 'col',
        }
      : null,
  };
}
