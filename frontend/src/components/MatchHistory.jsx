import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createShareLink, downloadReplay } from '../lib/replay';
import { useAuthStore } from '../store/authStore';
import { useRoute } from '../store/routeStore';
import { Button, Badge, Modal } from '../ui';
import { OpenReplayFileButton } from './ReplayViewer';

const MODE_LABEL = { basic: 'Classic', seafarers: 'Seafarers', cities: 'Cities & Knights' };

async function loadHistory(uid) {
  const { data, error } = await supabase
    .from('match_participants')
    .select(`final_vp, placement, is_winner,
             match:matches!match_participants_match_id_fkey!inner(id, room_code, mode, map_id, status, ended_at, replay_expires_at, replay_purged_at)`)
    .eq('user_id', uid)
    .in('match.status', ['finished', 'abandoned'])
    .order('joined_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data;
}

function daysLeft(expires) {
  const d = Math.ceil((new Date(expires) - Date.now()) / 86400000);
  return d > 0 ? d : 0;
}

function Row({ row }) {
  const navigate = useRoute((s) => s.navigate);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const m = row.match;
  const hasReplay = m.status === 'finished' && !m.replay_purged_at && m.replay_expires_at && daysLeft(m.replay_expires_at) > 0;
  const run = async (fn) => {
    setBusy(true); setNotice('');
    try { await fn(); } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col gap-1.5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col text-left min-w-0">
          <span className="font-extrabold text-sm truncate">
            {MODE_LABEL[m.mode] || m.mode} · {m.room_code}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {m.ended_at ? new Date(m.ended_at).toLocaleString('vi-VN') : ''}
          </span>
        </div>
        {m.status === 'abandoned'
          ? <Badge>Bỏ dở</Badge>
          : row.is_winner
            ? <Badge tone="success">🏆 Thắng · {row.final_vp} VP</Badge>
            : <Badge>Hạng {row.placement} · {row.final_vp} VP</Badge>}
      </div>
      {hasReplay ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button size="sm" onClick={() => navigate(`/replay/${m.id}`)}>▶ Xem lại</Button>
          <Button size="sm" variant="soft" tone="info" disabled={busy} onClick={() => run(async () => {
            const link = await createShareLink(m.id);
            await navigator.clipboard.writeText(link).catch(() => {});
            setNotice(`Đã copy link: ${link}`);
          })}>🔗 Chia sẻ</Button>
          <Button size="sm" variant="soft" tone="neutral" disabled={busy} onClick={() => run(() => downloadReplay(m.id))}>⬇️ Tải về</Button>
          <span className="text-[11px] ml-auto" style={{ color: 'var(--muted)' }}>Replay còn {daysLeft(m.replay_expires_at)} ngày</span>
        </div>
      ) : m.status === 'finished' && (
        <span className="text-[11px] text-left" style={{ color: 'var(--muted)' }}>Replay đã hết hạn trên máy chủ.</span>
      )}
      {notice && <span className="text-xs font-semibold break-all text-left" style={{ color: 'var(--text-2)' }}>{notice}</span>}
    </li>
  );
}

export default function MatchHistoryButton() {
  const uid = useAuthStore((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !uid) return;
    let cancelled = false;
    loadHistory(uid).then((d) => !cancelled && setRows(d), (e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [open, uid]);

  if (!uid) return null;
  return (
    <>
      <Button variant="soft" tone="neutral" size="sm" onClick={() => { setRows(null); setError(''); setOpen(true); }}>📜 Lịch sử</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Lịch sử ván đấu" maxWidth={520}>
        <div className="flex flex-col gap-2 overflow-y-auto -mx-1 px-1" style={{ maxHeight: 'calc(100dvh - 160px)' }}>
          <p className="text-xs text-left" style={{ color: 'var(--muted)' }}>
            Replay được giữ trên máy chủ vài ngày. Tải file về để xem lại bất cứ lúc nào.
          </p>
          {error && <div role="alert" className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error}</div>}
          {!rows && !error && <div className="text-sm py-4" style={{ color: 'var(--muted)' }}>Đang tải…</div>}
          {rows && !rows.length && <div className="text-sm py-4" style={{ color: 'var(--muted)' }}>Chưa có ván nào.</div>}
          {rows && rows.length > 0 && <ul className="flex flex-col">{rows.map((r) => <Row key={r.match.id} row={r} />)}</ul>}
          <div className="flex justify-center pt-1"><OpenReplayFileButton /></div>
        </div>
      </Modal>
    </>
  );
}
