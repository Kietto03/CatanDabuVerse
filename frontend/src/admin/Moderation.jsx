import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Badge, Button } from '../ui';
import { ago, q, supabase, useLoad, when } from './data';
import { ErrorNote, Section, StatusBadge } from './parts';

const CATEGORY = { cheating: 'Gian lận', abuse: 'Lăng mạ', afk: 'Bỏ ván / AFK', other: 'Khác' };
const REPORT_STATUS = { open: ['critical', 'Mới'], in_review: ['warning', 'Đang xử lý'], resolved: ['good', 'Đã xử lý'], dismissed: ['neutral', 'Bỏ qua'] };
const DURATIONS = [
  { label: '1 giờ', ms: 3600e3 }, { label: '24 giờ', ms: 86400e3 }, { label: '7 ngày', ms: 7 * 86400e3 },
  { label: '30 ngày', ms: 30 * 86400e3 }, { label: 'Vĩnh viễn', ms: null },
];
const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' };

// ---------------------------------------------------------------------------
function Reports({ onOpenUser }) {
  const me = useAuthStore((s) => s.user?.id);
  const [filter, setFilter] = useState('active');
  const [notice, setNotice] = useState('');
  const { data, error, reload } = useLoad(() => q(supabase.from('reports')
    .select(`id, category, details, status, resolution, created_at, resolved_at, match_id,
             reporter:profiles!reports_reporter_id_fkey(display_name, username),
             reported:profiles!reports_reported_id_fkey(id, display_name, username),
             assignee:profiles!reports_assigned_to_fkey(display_name)`)
    .in('status', filter === 'active' ? ['open', 'in_review'] : ['resolved', 'dismissed'])
    .order('created_at', { ascending: filter !== 'active' ? false : true }).limit(50)), [filter], 20000);

  const update = async (r, patch) => {
    setNotice('');
    try { await q(supabase.from('reports').update(patch).eq('id', r.id).select('id')); reload(); }
    catch (e) { setNotice(e.message); }
  };
  const close = (r, status) => {
    const resolution = window.prompt(status === 'resolved' ? 'Đã xử lý thế nào? (vd: tắt chat 24h)' : 'Lý do bỏ qua:');
    if (resolution == null) return;
    update(r, { status, resolution: resolution.trim() || null, resolved_at: new Date().toISOString(), assigned_to: r.assignee ? undefined : me });
  };

  return (
    <Section title="Báo cáo từ người chơi" right={
      <div className="flex gap-1">
        {[['active', 'Cần xử lý'], ['closed', 'Đã đóng']].map(([k, l]) => (
          <Button key={k} size="sm" variant={filter === k ? 'solid' : 'ghost'} tone="neutral" onClick={() => setFilter(k)}>{l}</Button>
        ))}
      </div>}>
      <ErrorNote error={error || notice} />
      {!data ? <div className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải…</div>
        : data.length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>Không có báo cáo.</div>
        : (
          <ul className="flex flex-col">
            {data.map((r) => {
              const [tone, label] = REPORT_STATUS[r.status];
              return (
                <li key={r.id} className="py-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={tone}>{label}</StatusBadge>
                    <Badge>{CATEGORY[r.category] || r.category}</Badge>
                    <span className="text-sm">
                      <button className="font-extrabold underline-offset-2 hover:underline" onClick={() => onOpenUser(r.reported.id)}>{r.reported.display_name}</button>
                      <span style={{ color: 'var(--muted)' }}> bị báo cáo bởi {r.reporter?.display_name || '—'} · {ago(r.created_at)}</span>
                    </span>
                  </div>
                  {r.details && <p className="text-sm" style={{ color: 'var(--text-2)' }}>“{r.details}”</p>}
                  {r.assignee && r.status === 'in_review' && <span className="text-xs" style={{ color: 'var(--muted)' }}>Người xử lý: {r.assignee.display_name}</span>}
                  {r.resolution && <span className="text-xs" style={{ color: 'var(--muted)' }}>Kết quả: {r.resolution} ({when(r.resolved_at)})</span>}
                  {filter === 'active' && (
                    <div className="flex gap-1.5 flex-wrap">
                      {r.status === 'open' && <Button size="sm" variant="soft" tone="info" onClick={() => update(r, { status: 'in_review', assigned_to: me })}>Nhận xử lý</Button>}
                      <Button size="sm" variant="soft" tone="success" onClick={() => close(r, 'resolved')}>Đã xử lý</Button>
                      <Button size="sm" variant="ghost" onClick={() => close(r, 'dismissed')}>Bỏ qua</Button>
                      <Button size="sm" variant="ghost" onClick={() => onOpenUser(r.reported.id)}>Xem người chơi →</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
function UserDetail({ userId, has }) {
  const me = useAuthStore((s) => s.user?.id);
  const [notice, setNotice] = useState(null);   // { ok, msg }
  const [kind, setKind] = useState(has('user.ban') ? 'ban' : 'mute');
  const [duration, setDuration] = useState(1);
  const [reason, setReason] = useState('');
  const [roleToAdd, setRoleToAdd] = useState('');
  const { data, error, reload } = useLoad(async () => {
    const [[user], sanctions, roles] = await Promise.all([
      q(supabase.from('v_user_overview').select('*').eq('id', userId)),
      q(supabase.from('sanctions').select('id, kind, reason, issued_at, expires_at, revoked_at, issuer:profiles!sanctions_issued_by_fkey(display_name)')
        .eq('user_id', userId).order('issued_at', { ascending: false }).limit(20)),
      has('role.assign') ? q(supabase.from('roles').select('id, key').order('id')) : Promise.resolve([]),
    ]);
    return { user, sanctions, roles };
  }, [userId]);

  const act = async (fn, ok) => {
    setNotice(null);
    try { await fn(); setNotice({ ok: true, msg: ok }); reload(); } catch (e) { setNotice({ ok: false, msg: e.message }); }
  };
  if (!data) return error ? <ErrorNote error={error} /> : null;
  const { user, sanctions, roles } = data;
  if (!user) return <div className="text-sm">Không tìm thấy người dùng.</div>;
  const active = (s) => !s.revoked_at && (!s.expires_at || new Date(s.expires_at) > new Date());

  const issue = (e) => {
    e.preventDefault();
    if (!reason.trim()) return setNotice({ ok: false, msg: 'Cần nhập lý do.' });
    const ms = DURATIONS[duration].ms;
    act(() => q(supabase.from('sanctions').insert({
      user_id: userId, kind, reason: reason.trim(), issued_by: me,
      expires_at: ms ? new Date(Date.now() + ms).toISOString() : null,
    }).select('id')), kind === 'ban' ? 'Đã khoá tài khoản.' : 'Đã tắt chat.').then(() => setReason(''));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg font-black">{user.display_name}</span>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>@{user.username}</span>
        {user.is_guest && <Badge>Khách</Badge>}
        {user.roles.map((r) => (
          <Badge key={r} tone="info">
            {r}
            {has('role.assign') && !['player', 'guest'].includes(r) && (
              <button aria-label={`Gỡ quyền ${r}`} className="ml-1" onClick={() => {
                if (!window.confirm(`Gỡ quyền ${r} của ${user.display_name}?`)) return;
                const id = roles.find((x) => x.key === r)?.id;
                act(() => q(supabase.from('user_roles').delete().eq('user_id', userId).eq('role_id', id).select('user_id')), `Đã gỡ ${r}.`);
              }}>✕</button>
            )}
          </Badge>
        ))}
      </div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>
        Tạo {when(user.created_at)} · hoạt động {ago(user.last_seen_at)} · id {user.id}
      </div>
      {notice && <div role={notice.ok ? 'status' : 'alert'} className="text-sm font-semibold"
        style={{ color: notice.ok ? 'var(--success)' : 'var(--danger)' }}>{notice.msg}</div>}

      {has('role.assign') && (
        <div className="flex gap-2 items-center flex-wrap">
          <select value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value)} className="focusable px-2 py-1.5 text-sm" style={inputStyle} aria-label="Quyền để cấp">
            <option value="">Cấp quyền…</option>
            {roles.filter((r) => !user.roles.includes(r.key)).map((r) => <option key={r.id} value={r.id}>{r.key}</option>)}
          </select>
          <Button size="sm" variant="soft" tone="info" disabled={!roleToAdd} onClick={() => act(
            () => q(supabase.from('user_roles').insert({ user_id: userId, role_id: Number(roleToAdd), granted_by: me }).select('user_id')),
            'Đã cấp quyền (có hiệu lực khi người đó làm mới phiên).').then(() => setRoleToAdd(''))}>Cấp</Button>
        </div>
      )}

      {(has('user.mute') || has('user.ban')) && (
        <form onSubmit={issue} className="flex gap-2 items-center flex-wrap">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="focusable px-2 py-1.5 text-sm" style={inputStyle} aria-label="Hình thức">
            {has('user.ban') && <option value="ban">Khoá tài khoản</option>}
            <option value="mute">Tắt chat</option>
          </select>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="focusable px-2 py-1.5 text-sm" style={inputStyle} aria-label="Thời hạn">
            {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do" aria-label="Lý do"
            className="focusable px-2 py-1.5 text-sm flex-1 min-w-[10rem]" style={inputStyle} />
          <Button size="sm" tone="danger" type="submit">Áp dụng</Button>
        </form>
      )}

      <div>
        <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>Lịch sử xử phạt</div>
        {sanctions.length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có.</div> : (
          <ul className="flex flex-col text-sm">
            {sanctions.map((s) => (
              <li key={s.id} className="py-1.5 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
                <StatusBadge tone={active(s) ? 'critical' : 'neutral'}>{s.kind === 'ban' ? 'Khoá' : 'Tắt chat'}{active(s) ? '' : ' (hết hiệu lực)'}</StatusBadge>
                <span>{s.reason}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.issuer?.display_name || 'hệ thống'} · {ago(s.issued_at)} · {s.revoked_at ? `gỡ ${ago(s.revoked_at)}` : s.expires_at ? `hết hạn ${when(s.expires_at)}` : 'vĩnh viễn'}
                </span>
                {active(s) && (has('user.ban') || s.kind === 'mute') && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => q(supabase.from('sanctions')
                    .update({ revoked_at: new Date().toISOString(), revoked_by: me }).eq('id', s.id).select('id')), 'Đã gỡ xử phạt.')}>Gỡ</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Users({ selected, onSelect, has }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const search = async (e) => {
    e.preventDefault();
    const t = term.trim().replace(/[^\p{L}\p{N}_ -]/gu, '');
    setError('');
    try {
      const uuid = /^[0-9a-f-]{36}$/i.test(term.trim());
      const qb = supabase.from('v_user_overview').select('id, username, display_name, is_guest, roles, active_sanctions, last_seen_at').limit(20);
      setResults(await q(uuid ? qb.eq('id', term.trim()) : qb.or(`username.ilike.%${t}%,display_name.ilike.%${t}%`).order('last_seen_at', { ascending: false, nullsFirst: false })));
    } catch (err) { setError(err.message); }
  };
  return (
    <Section title="Người dùng">
      <form onSubmit={search} className="flex gap-2">
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tên, tên đăng nhập hoặc id" aria-label="Tìm người dùng"
          className="focusable px-3 py-2 text-sm flex-1" style={inputStyle} />
        <Button size="sm" type="submit">Tìm</Button>
      </form>
      <ErrorNote error={error} />
      {results && (
        <ul className="flex flex-col text-sm">
          {results.length === 0 && <li style={{ color: 'var(--muted)' }}>Không có kết quả.</li>}
          {results.map((u) => (
            <li key={u.id}>
              <button onClick={() => onSelect(u.id)} className="w-full text-left py-2 px-2 flex items-center gap-2 flex-wrap focusable"
                style={{ borderTop: '1px solid var(--border)', background: selected === u.id ? 'var(--accent-soft)' : 'transparent', borderRadius: 'var(--radius-sm)' }}>
                <span className="font-bold">{u.display_name}</span>
                <span style={{ color: 'var(--muted)' }}>@{u.username}</span>
                {u.is_guest && <Badge>Khách</Badge>}
                {u.roles.filter((r) => !['player', 'guest'].includes(r)).map((r) => <Badge key={r} tone="info">{r}</Badge>)}
                {u.active_sanctions > 0 && <StatusBadge tone="critical">Đang bị xử phạt</StatusBadge>}
                <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{ago(u.last_seen_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}><UserDetail key={selected} userId={selected} has={has} /></div>}
    </Section>
  );
}

export default function Moderation({ has }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {has('report.resolve') && <Reports onOpenUser={setSelected} />}
      <Users selected={selected} onSelect={setSelected} has={has} />
    </div>
  );
}
