import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export { supabase };

export const MODE_LABEL = { basic: 'Classic', seafarers: 'Seafarers', cities: 'Cities & Knights' };

export async function q(builder) {
  const { data, error, count } = await builder;
  if (error) throw new Error(error.message);
  return count ?? data;
}

/** Load with `fn`, re-run every `refreshMs` (0 = never) and on demand via `reload`. */
export function useLoad(fn, deps, refreshMs = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    fn().then((d) => { if (!cancelled) { setData(d); setError(''); } }, (e) => !cancelled && setError(e.message));
    const t = refreshMs ? setInterval(() => setTick((x) => x + 1), refreshMs) : null;
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}

export const ago = (iso) => {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
};
export const when = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN') : '—');

/** Last `n` UTC days as YYYY-MM-DD, oldest first (views bucket by UTC day). */
export function lastDays(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Series colors (validated on #ffffff: CVD ΔE 9.2, normal ΔE 27.6; aqua is
// 2.82:1, so legend + tooltip + table carry identity, never color alone).
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
