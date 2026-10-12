import { useAuthStore } from '../store/authStore';
import { useRoute } from '../store/routeStore';
import { Button, Panel } from '../ui';
import Overview from './Overview';
import Operations from './Operations';
import Moderation from './Moderation';
import { AuditLog, Settings } from './AuditSettings';

// Each tab needs one of these permissions (from the JWT; RLS enforces the same).
const TABS = [
  { key: 'overview',   label: '📊 Tổng quan',     perms: ['monitor.view'],               Page: Overview },
  { key: 'operations', label: '🖥️ Ván & máy chủ', perms: ['monitor.view'],               Page: Operations },
  { key: 'moderation', label: '🛡️ Kiểm duyệt',    perms: ['report.resolve', 'user.mute'], Page: Moderation },
  { key: 'audit',      label: '📜 Nhật ký',        perms: ['audit.view'],                 Page: AuditLog },
  { key: 'settings',   label: '⚙️ Cài đặt',        perms: ['config.manage'],              Page: Settings },
];

export default function AdminApp({ tab }) {
  const navigate = useRoute((s) => s.navigate);
  const permissions = useAuthStore((s) => s.permissions);
  const profile = useAuthStore((s) => s.profile);
  const has = (p) => permissions.includes(p) || permissions.includes('*');
  const visible = TABS.filter((t) => t.perms.some(has));

  if (!visible.length) {
    return (
      <div className="w-full max-w-[440px] p-4">
        <Panel className="p-7 flex flex-col gap-3 text-center">
          <div className="text-3xl" aria-hidden="true">🔒</div>
          <h1 className="text-xl font-black">Không có quyền truy cập</h1>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>Trang quản trị chỉ dành cho quản trị viên và người kiểm duyệt.</p>
          <Button onClick={() => navigate('/')}>Về sảnh</Button>
        </Panel>
      </div>
    );
  }
  const current = visible.find((t) => t.key === tab) || visible[0];
  const { Page } = current;

  return (
    <div className="w-full min-h-screen self-stretch flex flex-col md:flex-row" style={{ background: 'var(--bg)' }}>
      <nav className="md:w-56 shrink-0 p-3 flex md:flex-col gap-1 overflow-x-auto md:min-h-screen"
           style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }} aria-label="Quản trị">
        <div className="hidden md:flex flex-col px-2 pb-3 mb-1 text-left" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-black">🛠 Quản trị</span>
          <span className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>{profile?.display_name}</span>
        </div>
        {visible.map((t) => (
          <button key={t.key} onClick={() => navigate(`/admin/${t.key}`)} aria-current={t.key === current.key ? 'page' : undefined}
            className="focusable text-left text-sm font-bold px-3 py-2 whitespace-nowrap"
            style={{ borderRadius: 'var(--radius-sm)', background: t.key === current.key ? 'var(--accent-soft)' : 'transparent',
                     color: t.key === current.key ? 'var(--accent-ink)' : 'var(--text-2)' }}>
            {t.label}
          </button>
        ))}
        <button onClick={() => navigate('/')} className="focusable text-left text-sm font-bold px-3 py-2 whitespace-nowrap md:mt-auto"
          style={{ color: 'var(--muted)' }}>← Về sảnh</button>
      </nav>
      <main className="flex-1 min-w-0 p-3 sm:p-5 flex flex-col gap-4 text-left">
        <h1 className="text-xl font-black">{current.label.replace(/^\S+\s/, '')}</h1>
        <Page has={has} />
      </main>
    </div>
  );
}
