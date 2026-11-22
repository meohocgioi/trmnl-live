// Tự tính bố cục collage cho TRMNL: thử mọi cách chia màn hình (ngang/dọc lồng nhau),
// chia kích thước theo đúng tỉ lệ ảnh, chọn cách cho diện tích hình live lớn nhất.
const W = 780; // vùng nội dung xấp xỉ (px) của TRMNL 800x480
const H = 452;
const GAP = 8;
const HEAD = 30; // thanh tiêu đề mỗi ô live

// Diện tích hình hiển thị khi đặt ảnh tỉ lệ ar vào ô w x h (trừ thanh tiêu đề)
function fit(ar, w, h) {
  const ih = Math.max(1, h - HEAD);
  const sw = Math.min(w, ih * ar);
  return sw * (sw / ar);
}

// Sinh mọi cây chia (lá = 1 người live; nút = chia 'v' cạnh nhau / 'h' chồng lên nhau)
function trees(items) {
  if (items.length === 1) return [{ leaf: items[0], ar: items[0].ar }];
  const out = [];
  const n = items.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const A = items.filter((_, k) => mask & (1 << k));
    const B = items.filter((_, k) => !(mask & (1 << k)));
    const TA = trees(A), TB = trees(B);
    for (const a of TA) for (const b of TB) {
      out.push({ dir: 'v', a, b, ar: a.ar + b.ar }); // cạnh nhau: rộng cộng dồn
      out.push({ dir: 'h', a, b, ar: 1 / (1 / a.ar + 1 / b.ar) }); // chồng nhau: cao cộng dồn
    }
  }
  return out;
}

const clamp = (t) => Math.min(0.78, Math.max(0.22, t));

// Đặt cây vào hình chữ nhật r, trả danh sách ô + điểm
function place(t, r, cells) {
  if (t.leaf) {
    cells.push({ i: t.leaf.i, x: r.x, y: r.y, w: r.w, h: r.h });
    return fit(t.leaf.ar, r.w, r.h);
  }
  if (t.dir === 'v') {
    const w1 = (r.w - GAP) * clamp(t.a.ar / (t.a.ar + t.b.ar));
    return place(t.a, { x: r.x, y: r.y, w: w1, h: r.h }, cells) +
      place(t.b, { x: r.x + w1 + GAP, y: r.y, w: r.w - GAP - w1, h: r.h }, cells);
  }
  const ia = 1 / t.a.ar, ib = 1 / t.b.ar;
  const h1 = (r.h - GAP) * clamp(ia / (ia + ib));
  return place(t.a, { x: r.x, y: r.y, w: r.w, h: h1 }, cells) +
    place(t.b, { x: r.x, y: r.y + h1 + GAP, w: r.w, h: r.h - GAP - h1 }, cells);
}

const pct = (v, total) => Math.round((v / total) * 10000) / 100;

/**
 * live: [{ i, ar }]  (i = vị trí trong mảng users)
 * offCount: số người offline cần hiện
 * Trả: { cells:[{i,x,y,w,h,size}], off:{x,y,w,h,dir} | null }  (đơn vị %)
 */
export function computeLayout(live, offCount) {
  if (!live.length) return null;
  const options = [];
  if (offCount > 0) {
    // Cột offline hẹp bên phải, hoặc hàng offline thấp bên dưới
    const colW = 170;
    const rowH = 88;
    options.push({ live: { x: 0, y: 0, w: W - colW - GAP, h: H }, off: { x: W - colW, y: 0, w: colW, h: H, dir: 'col' } });
    options.push({ live: { x: 0, y: 0, w: W, h: H - rowH - GAP }, off: { x: 0, y: H - rowH, w: W, h: rowH, dir: 'row' } });
  } else {
    options.push({ live: { x: 0, y: 0, w: W, h: H }, off: null });
  }
  const all = trees(live);
  let pick = null;
  for (const o of options) {
    for (const t of all) {
      const cells = [];
      const s = place(t, o.live, cells);
      // ưu tiên nhẹ cột offline bên phải (theo phác thảo của bạn)
      const score = s * (o.off && o.off.dir === 'col' ? 1.04 : 1);
      if (!pick || score > pick.score) pick = { score, cells, off: o.off };
    }
  }
  // Thu ô live về đúng kích thước ảnh (dồn trái/trên) rồi cho phần offline lấp chỗ trống
  const arOf = new Map(live.map((l) => [l.i, l.ar]));
  const cells = pick.cells.map((c) => {
    const ar = arOf.get(c.i);
    const iw = Math.min(c.w, (c.h - HEAD) * ar);
    return { ...c, w: Math.max(90, iw), h: Math.min(c.h, iw / ar + HEAD) };
  });
  // Dồn các ô lên trên rồi sang trái để khép khoảng hở sau khi thu nhỏ
  const overlap = (a1, a2, b1, b2) => a1 < b2 - 1 && b1 < a2 - 1;
  for (const c of [...cells].sort((p, q) => p.y - q.y)) {
    const above = cells.filter((o) => o !== c && o.y + o.h <= c.y + 1 && overlap(o.x, o.x + o.w, c.x, c.x + c.w));
    c.y = above.length ? Math.max(...above.map((o) => o.y + o.h + GAP)) : 0;
  }
  for (const c of [...cells].sort((p, q) => p.x - q.x)) {
    const left = cells.filter((o) => o !== c && o.x + o.w <= c.x + 1 && overlap(o.y, o.y + o.h, c.y, c.y + c.h));
    c.x = left.length ? Math.max(...left.map((o) => o.x + o.w + GAP)) : 0;
  }
  let off = pick.off;
  if (off && off.dir === 'col') {
    const right = Math.max(...cells.map((c) => c.x + c.w));
    off = { ...off, x: right + GAP, w: W - right - GAP };
  } else if (off && off.dir === 'row') {
    const bottom = Math.max(...cells.map((c) => c.y + c.h));
    off = { ...off, y: bottom + GAP, h: H - bottom - GAP };
  }
  // Căn giữa cả khối live theo chiều còn dư (khi không có phần offline chiếm chỗ)
  if (!off) {
    const right = Math.max(...cells.map((c) => c.x + c.w));
    const bottom = Math.max(...cells.map((c) => c.y + c.h));
    const dx = (W - right) / 2, dy = (H - bottom) / 2;
    for (const c of cells) { c.x += dx; c.y += dy; }
  }
  return {
    cells: cells.map((c) => ({
      i: c.i,
      x: pct(c.x, W), y: pct(c.y, H), w: pct(c.w, W), h: pct(c.h, H),
      size: c.w < 230 || c.h < 160 ? 's' : c.w < 380 ? 'm' : 'l',
    })),
    off: off
      ? {
          x: pct(off.x, W), y: pct(off.y, H), w: pct(off.w, W), h: pct(off.h, H),
          // khối offline rộng -> xếp lưới 2 cột cho giống collage
          dir: off.dir === 'col' && off.w > 330 && offCount > 1 ? 'grid' : off.dir,
        }
      : null,
  };
}
