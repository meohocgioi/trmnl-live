// Hằng số dùng chung giữa bộ sinh bảng (scripts/gen-layouts.mjs) và Worker.
export const W = 780; // vùng nội dung (px) của TRMNL 800x480
export const H_FULL = 452;
export const GAP = 8;
export const HEAD = 28; // thanh tiêu đề mỗi ô live
export const SB_BOTTOM = 42; // thanh status dưới đáy (34px + khoảng cách)

// Nhóm tỉ lệ ảnh (rộng/cao): dọc 9:16, 3:4, vuông, 4:3, ngang 16:9
export const BUCKETS = [0.5625, 0.75, 1, 1.333, 1.778];
export function bucketOf(ar) {
  let best = 0;
  for (let b = 1; b < BUCKETS.length; b++) {
    if (Math.abs(Math.log(ar / BUCKETS[b])) < Math.abs(Math.log(ar / BUCKETS[best]))) best = b;
  }
  return best;
}
export const offNeed = (n) => n * 190 * 70; // mỗi ô offline cần ~190x70
export const offAr = (n) => (n === 1 ? 2.8 : n === 2 ? 1.4 : 0.9);
export const keyOf = (buckets, off, status) => `${buckets.join('')}|${off}|${status ? 1 : 0}`;
