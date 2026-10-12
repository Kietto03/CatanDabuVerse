import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { Button, Modal } from '../ui';

const CATEGORIES = [
  ['abuse', 'Lăng mạ / ngôn từ xúc phạm'],
  ['cheating', 'Gian lận'],
  ['afk', 'Bỏ ván / treo máy'],
  ['other', 'Khác'],
];

/** ⚑ next to another player's name: files a report for the moderation queue. */
export default function ReportPlayerButton({ slot, matchId }) {
  const me = useAuthStore((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('abuse');
  const [details, setDetails] = useState('');
  const [state, setState] = useState(null);   // null | 'sending' | { ok, msg }

  if (!supabase || !me || !slot.userId || slot.userId === me) return null;

  const submit = async (e) => {
    e.preventDefault();
    setState('sending');
    const { error } = await supabase.from('reports').insert({
      reporter_id: me, reported_id: slot.userId, match_id: matchId || null,
      category, details: details.trim() || null,
    });
    if (!error) setState({ ok: true, msg: 'Đã gửi báo cáo. Cảm ơn bạn, đội kiểm duyệt sẽ xem xét.' });
    else if (error.code === '23505') setState({ ok: false, msg: 'Bạn đã báo cáo người này trong ván này rồi.' });
    else setState({ ok: false, msg: error.message });
  };
  const close = () => { setOpen(false); setState(null); setDetails(''); };

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={`Báo cáo ${slot.username}`}
        aria-label={`Báo cáo ${slot.username}`} className="focusable shrink-0 text-[11px] leading-none px-1 opacity-60 hover:opacity-100">
        ⚑
      </button>
      <Modal open={open} onClose={close} title={`Báo cáo ${slot.username}`} maxWidth={400}>
        {state?.ok ? (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-sm" role="status">{state.msg}</p>
            <Button onClick={close}>Đóng</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3 text-left">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[11px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>Lý do</legend>
              {CATEGORIES.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="report-category" value={k} checked={category === k} onChange={() => setCategory(k)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Chi tiết (không bắt buộc)</span>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3}
                className="focusable px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' }} />
            </label>
            {state && !state.ok && state !== 'sending' && (
              <div role="alert" className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{state.msg}</div>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={close}>Huỷ</Button>
              <Button type="submit" tone="danger" disabled={state === 'sending'}>Gửi báo cáo</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
