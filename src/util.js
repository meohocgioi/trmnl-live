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
