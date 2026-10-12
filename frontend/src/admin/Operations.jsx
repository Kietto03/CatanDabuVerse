import { useState } from 'react';
import { Button } from '../ui';
import { MODE_LABEL, ago, q, supabase, useLoad, when } from './data';
import { ErrorNote, Section, StatusBadge } from './parts';

const STATE_LABEL = { lobby: 'Phòng chờ', setup: 'Đặt quân', playing: 'Đang chơi' };

async function loadOps() {
  const [matches, servers] = await Promise.all([
    q(supabase.from('v_live_matches').select('*').order('started_at', { ascending: false, nullsFirst: false })),
    q(supabase.from('v_server_health').select('*')
      .gte('last_heartbeat_at', new Date(Date.now() - 86400000).toISOString())
      .order('started_at', { ascending: false })),
  ]);
  return { matches, servers };
}

function serverTone(s) {
  if (s.status === 'dead' || !s.is_alive) return ['critical', s.status === 'dead' ? 'Đã dừng' : 'Mất kết nối'];
  if (s.status === 'draining') return ['warning', 'Đang rút'];
  return ['good', 'Hoạt động'];
}

const th = 'py-2 pr-3 text-[11px] font-extrabold uppercase tracking-wider';
const td = 'py-2 pr-3 align-middle';

export default function Operations({ has }) {
  const { data, error, reload } = useLoad(loadOps, [], 10000);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (key, fn) => {
    setBusy(key); setNotice('');
    try { await fn(); reload(); } catch (e) { setNotice(e.message); } finally { setBusy(''); }
  };

  const terminate = (m) => {
    const reason = window.prompt(`Kết thúc ván ${m.room_code}? Nhập lý do (bắt buộc):`);
    if (!reason?.trim()) return;
    run(m.id, async () => {
      const ok = await q(supabase.rpc('admin_terminate_match', { p_match_id: m.id, p_reason: reason.trim() }));
      setNotice(ok ? `Đã kết thúc ${m.room_code}. Máy chủ sẽ đóng phòng trong vài giây.` : 'Ván này đã kết thúc trước đó.');
    });
  };
  const setStatus = (s, status) => run(s.id, async () => {
    await q(supabase.from('game_servers').update({ status }).eq('id', s.id).select('id'));
  });

  if (!data) return error ? <ErrorNote error={error} /> : <div className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải…</div>;
  const serverUrl = Object.fromEntries(data.servers.map((s) => [s.id, s.public_url]));

  return (
    <>
      <ErrorNote error={error || notice} />
      <Section title={`Ván đang mở (${data.matches.length})`} right={<span className="text-xs" style={{ color: 'var(--muted)' }}>tự làm mới mỗi 10 giây</span>}>
        {data.matches.length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>Không có ván nào.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead style={{ color: 'var(--muted)' }}><tr>
                <th className={th}>Phòng</th><th className={th}>Chế độ</th><th className={th}>Trạng thái</th>
                <th className={th}>Bắt đầu</th><th className={th}>Người / Bot</th><th className={th}>Máy chủ</th><th className={th} />
              </tr></thead>
              <tbody>
                {data.matches.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className={`${td} font-extrabold`}>{m.room_code}</td>
                    <td className={td}>{MODE_LABEL[m.mode] || m.mode}</td>
                    <td className={td}>{STATE_LABEL[m.status] || m.status}</td>
                    <td className={td} title={when(m.started_at)}>{m.started_at ? ago(m.started_at) : '—'}</td>
                    <td className={`${td} tabular-nums`}>{m.humans} / {m.bots}</td>
                    <td className={`${td} text-xs`} style={{ color: 'var(--text-2)' }}>{serverUrl[m.server_id] || '—'}</td>
                    <td className={`${td} text-right`}>
                      {has('match.terminate') && (
                        <Button size="sm" variant="soft" tone="danger" disabled={busy === m.id} onClick={() => terminate(m)}>Kết thúc</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Máy chủ game (24 giờ qua)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead style={{ color: 'var(--muted)' }}><tr>
              <th className={th}>Máy chủ</th><th className={th}>Trạng thái</th><th className={th}>Nhịp tim</th>
              <th className={th}>Phòng</th><th className={th}>Kết nối</th><th className={th}>Tải / RAM</th><th className={th} />
            </tr></thead>
            <tbody>
              {data.servers.map((s) => {
                const [tone, label] = serverTone(s);
                const live = s.status !== 'dead' && s.is_alive;
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)', opacity: live ? 1 : 0.6 }}>
                    <td className={td}>
                      <div className="font-bold">{s.public_url}</div>
                      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{s.hostname}{s.region ? ` · ${s.region}` : ''} · từ {ago(s.started_at)}</div>
                    </td>
                    <td className={td}><StatusBadge tone={tone}>{label}</StatusBadge></td>
                    <td className={td}>{ago(s.last_heartbeat_at)}</td>
                    <td className={`${td} tabular-nums`}>{s.active_rooms} / {s.max_rooms}</td>
                    <td className={`${td} tabular-nums`}>{s.connected_sockets}</td>
                    <td className={`${td} tabular-nums text-xs`}>{s.cpu_percent != null ? Number(s.cpu_percent).toFixed(2) : '—'} / {s.mem_mb != null ? `${Math.round(s.mem_mb)} MB` : '—'}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      {has('server.manage') && live && s.status === 'active' && (
                        <Button size="sm" variant="soft" tone="neutral" disabled={busy === s.id} onClick={() => setStatus(s, 'draining')}>Rút (drain)</Button>
                      )}
                      {has('server.manage') && live && s.status === 'draining' && (
                        <Button size="sm" variant="soft" tone="success" disabled={busy === s.id} onClick={() => setStatus(s, 'active')}>Kích hoạt</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          “Rút” = không nhận phòng mới, các ván đang chơi vẫn tiếp tục. Dừng máy chủ (SIGTERM) sẽ chuyển ván sang máy chủ khác trong vài giây.
        </p>
      </Section>
    </>
  );
}
