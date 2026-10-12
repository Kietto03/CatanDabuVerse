import { useState } from 'react';
import { Button } from '../ui';
import { useAuthStore } from '../store/authStore';
import { StatTile } from './charts';
import { ago, q, supabase, useLoad, when } from './data';
import { ErrorNote, Section } from './parts';

const ACTION_LABEL = {
  'match.terminate': 'Kết thúc ván',
  'user_roles.insert': 'Cấp quyền', 'user_roles.delete': 'Gỡ quyền',
  'sanctions.insert': 'Xử phạt', 'sanctions.update': 'Gỡ xử phạt',
  'reports.update': 'Xử lý báo cáo', 'app_config.update': 'Đổi cài đặt',
  'game_servers.update': 'Đổi trạng thái máy chủ',
  'auth.guest_upgraded': 'Khách lưu tài khoản', 'replay.purge': 'Xoá replay hết hạn',
};
const FILTERS = [['', 'Tất cả'], ['admin', 'Thao tác quản trị'], ['auth.', 'Tài khoản'], ['replay.', 'Replay']];
const ADMIN_ACTIONS = Object.keys(ACTION_LABEL).filter((k) => !k.startsWith('auth.') && !k.startsWith('replay.'));

function summary(row) {
  const m = row.metadata || {};
  const n = m.new || {}; const o = m.old || {};
  switch (row.action) {
    case 'match.terminate': return `${m.room_code} — ${m.reason}`;
    case 'user_roles.insert': case 'user_roles.delete': return `role_id ${(n.role_id ?? o.role_id)}`;
    case 'sanctions.insert': return `${n.kind}: ${n.reason}${n.expires_at ? ` (đến ${when(n.expires_at)})` : ' (vĩnh viễn)'}`;
    case 'sanctions.update': return `${o.kind}: ${o.reason}`;
    case 'reports.update': return `${o.status} → ${n.status}${n.resolution ? `: ${n.resolution}` : ''}`;
    case 'app_config.update': return `${n.key}: ${JSON.stringify(o.value)} → ${JSON.stringify(n.value)}`;
    case 'game_servers.update': return `${n.public_url}: ${o.status} → ${n.status}`;
    case 'replay.purge': return `${m.matches} ván`;
    default: return '';
  }
}

export function AuditLog() {
  const [filter, setFilter] = useState('admin');
  const { data, error } = useLoad(async () => {
    let qb = supabase.from('audit_log')
      .select('id, action, target_type, target_id, metadata, created_at, actor:profiles!audit_log_actor_id_fkey(display_name, username)')
      .order('created_at', { ascending: false }).limit(150);
    if (filter === 'admin') qb = qb.in('action', ADMIN_ACTIONS);
    else if (filter) qb = qb.like('action', `${filter}%`);
    return q(qb);
  }, [filter], 30000);
  return (
    <Section title="Nhật ký hệ thống" right={
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(([k, l]) => <Button key={k || 'all'} size="sm" variant={filter === k ? 'solid' : 'ghost'} tone="neutral" onClick={() => setFilter(k)}>{l}</Button>)}
      </div>}>
      <ErrorNote error={error} />
      {!data ? <div className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải…</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead style={{ color: 'var(--muted)' }}><tr>
              {['Thời điểm', 'Người thực hiện', 'Hành động', 'Chi tiết'].map((h) => <th key={h} className="py-2 pr-3 text-[11px] font-extrabold uppercase tracking-wider">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan="4" className="py-3" style={{ color: 'var(--muted)' }}>Chưa có mục nào.</td></tr>}
              {data.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-2 pr-3 whitespace-nowrap" title={when(r.created_at)}>{ago(r.created_at)}</td>
                  <td className="py-2 pr-3">{r.actor?.display_name || <span style={{ color: 'var(--muted)' }}>hệ thống</span>}</td>
                  <td className="py-2 pr-3 font-bold whitespace-nowrap">{ACTION_LABEL[r.action] || r.action}</td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-2)' }}>{summary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

const SETTINGS = {
  replay_retention_days: { label: 'Giữ replay trên máy chủ (ngày)', min: 1, max: 90,
    help: 'Áp dụng cho ván kết thúc từ bây giờ. Người chơi vẫn xem được file đã tải về.' },
  replay_keyframe_every: { label: 'Khung đầy đủ mỗi N hành động', min: 5, max: 500,
    help: 'Nhỏ hơn = tua replay nhanh hơn nhưng tốn dung lượng hơn. Áp dụng khi máy chủ khởi động lại.' },
};

export function Settings() {
  const { data, error, reload } = useLoad(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
    const [config, [storage], exports7d] = await Promise.all([
      q(supabase.from('app_config').select('key, value, updated_at').order('key')),
      q(supabase.from('v_replay_storage').select('*')),
      q(supabase.from('replay_exports').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo)),
    ]);
    return { config, storage, exports7d };
  }, []);
  const [values, setValues] = useState({});
  const [notice, setNotice] = useState(null);

  const save = async (key) => {
    const meta = SETTINGS[key];
    const v = Number(values[key]);
    if (!Number.isInteger(v) || v < meta.min || v > meta.max) {
      return setNotice({ ok: false, msg: `${meta.label}: nhập số nguyên ${meta.min}–${meta.max}.` });
    }
    try {
      await q(supabase.from('app_config').update({ value: v, updated_at: new Date().toISOString(), updated_by: useAuthStore.getState().user?.id }).eq('key', key).select('key'));
      setNotice({ ok: true, msg: 'Đã lưu.' });
      setValues((s) => ({ ...s, [key]: undefined }));
      reload();
    } catch (e) { setNotice({ ok: false, msg: e.message }); }
  };

  if (!data) return error ? <ErrorNote error={error} /> : <div className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải…</div>;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatTile label="Ván có replay trên máy chủ" value={data.storage?.matches_with_replay ?? 0} sub={`${(data.storage?.events ?? 0).toLocaleString('vi-VN')} sự kiện`} />
        <StatTile label="Dung lượng replay (ước tính)" value={data.storage?.approx_size || '0 bytes'} />
        <StatTile label="Lượt tải replay (7 ngày)" value={data.exports7d} />
      </div>
      <Section title="Cài đặt">
        {notice && <div role={notice.ok ? 'status' : 'alert'} className="text-sm font-semibold" style={{ color: notice.ok ? 'var(--success)' : 'var(--danger)' }}>{notice.msg}</div>}
        {data.config.filter((c) => SETTINGS[c.key]).map((c) => {
          const meta = SETTINGS[c.key];
          const current = values[c.key] ?? String(c.value);
          return (
            <div key={c.key} className="flex flex-col gap-1 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <label htmlFor={`cfg-${c.key}`} className="text-sm font-bold">{meta.label}</label>
              <div className="flex gap-2 items-center">
                <input id={`cfg-${c.key}`} type="number" min={meta.min} max={meta.max} value={current}
                  onChange={(e) => setValues((s) => ({ ...s, [c.key]: e.target.value }))}
                  className="focusable px-2 py-1.5 text-sm w-28" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' }} />
                <Button size="sm" disabled={current === String(c.value)} onClick={() => save(c.key)}>Lưu</Button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>sửa {ago(c.updated_at)}</span>
              </div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{meta.help}</span>
            </div>
          );
        })}
      </Section>
    </>
  );
}
