const TZ = 'Asia/Ho_Chi_Minh';

export const fmtTime = (ms) =>
  ms ? new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : null;

export const fmtDateTime = (ms) =>
  ms
    ? new Date(ms).toLocaleString('en-GB', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
      })
    : null;

export const fmtDur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} phút`;
};

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Đọc kích thước ảnh PNG / JPEG / WEBP (để TRMNL biết tỉ lệ ảnh)
export function imgSize(buf) {
  try {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0);
    if (b[0] === 0x89 && b[1] === 0x50) {
      const dv = new DataView(b.buffer, b.byteOffset);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 8 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + len;
      }
    }
    if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      const f = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (f === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (f === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
      if (f === 'VP8L') {
        const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {}
  return null;
}
