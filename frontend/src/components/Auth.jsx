import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../store/authStore';
import { Button, Panel, Badge, Modal } from '../ui';
import { OpenReplayFileButton } from './ReplayViewer';

const inputStyle = {
  background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)', color: 'var(--text)',
};

function Input(props) {
  return <input {...props} className={`focusable px-4 py-2.5 font-semibold w-full ${props.className || ''}`} style={inputStyle} />;
}

function Notice({ tone, children }) {
  if (!children) return null;
  const c = tone === 'error'
    ? { bg: '#fde8e8', fg: '#9b1c1c' }
    : { bg: '#e3f6e9', fg: '#0f7a37' };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="text-sm font-semibold px-3 py-2 text-left"
         style={{ background: c.bg, color: c.fg, borderRadius: 'var(--radius-sm)' }}>
      {children}
    </div>
  );
}

function Divider({ label }) {
  return (
    <div className="flex items-center gap-3 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
      <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      {label}
      <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);
const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.7.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.8zM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/>
  </svg>
);

function ProviderButtons({ onClick, busy, verb = 'Tiếp tục' }) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="lg" disabled={busy} onClick={() => onClick('google')}><GoogleIcon /> {verb} với Google</Button>
      <Button variant="outline" size="lg" disabled={busy} onClick={() => onClick('discord')}><DiscordIcon /> {verb} với Discord</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login screen (shown before the lobby when Supabase auth is configured)
// ---------------------------------------------------------------------------
export function AuthScreen() {
  const auth = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(auth.urlError);
  const [info, setInfo] = useState('');
  const [guestName, setGuestName] = useState(localStorage.getItem('catan_username') || '');
  const [emailOpen, setEmailOpen] = useState(false);
  const [mode, setMode] = useState('signin'); // signin | signup | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const run = async (fn) => {
    setBusy(true); setError(''); setInfo(''); auth.clearUrlError();
    try { await fn(); } finally { setBusy(false); }
  };

  const onProvider = (p) => run(async () => setError(await auth.signInWithProvider(p)));
  const onGuest = (e) => {
    e.preventDefault();
    const n = guestName.trim();
    if (!n) return setError('Nhập tên hiển thị để chơi.');
    run(async () => setError(await auth.signInAsGuest(n)));
  };
  const onEmail = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'forgot') {
        const err = await auth.sendPasswordReset(email);
        if (err) setError(err); else setInfo('Đã gửi email đặt lại mật khẩu. Kiểm tra hộp thư của bạn.');
      } else if (mode === 'signup') {
        if (!name.trim()) return setError('Nhập tên hiển thị.');
        const r = await auth.signUpWithEmail(email, password, name.trim());
        if (r.error) setError(r.error);
        else if (r.needsConfirmation) setInfo('Đã tạo tài khoản! Mở email xác nhận rồi quay lại đăng nhập.');
      } else {
        setError(await auth.signInWithEmail(email, password));
      }
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="w-full max-w-[420px] p-4 my-8">
      <Panel className="p-7 flex flex-col gap-5 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="text-4xl" aria-hidden="true">🎲</span>
          <h1 className="text-2xl font-black tracking-tight">CatanDabuVerse</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Đăng nhập để lưu lịch sử ván đấu và xem lại replay.</p>
        </div>

        <Notice tone="error">{error}</Notice>
        <Notice tone="info">{info}</Notice>

        <ProviderButtons onClick={onProvider} busy={busy} />

        <Divider label="hoặc chơi ngay" />
        <form onSubmit={onGuest} className="flex gap-2">
          <Input placeholder="Tên hiển thị" maxLength={32} value={guestName} onChange={(e) => setGuestName(e.target.value)} aria-label="Tên hiển thị cho khách" />
          <Button type="submit" tone="accent" disabled={busy} className="shrink-0">Chơi khách</Button>
        </form>
        <p className="text-[11px] -mt-3" style={{ color: 'var(--muted)' }}>Tài khoản khách có thể lưu lại sau bằng Google, Discord hoặc email.</p>

        <Divider label="email" />
        {!emailOpen ? (
          <Button variant="ghost" onClick={() => setEmailOpen(true)}>Đăng nhập bằng email</Button>
        ) : (
          <AnimatePresence mode="wait">
            <motion.form key={mode} onSubmit={onEmail} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col gap-2.5 text-left">
              {mode === 'signup' && (
                <Input placeholder="Tên hiển thị" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} aria-label="Tên hiển thị" />
              )}
              <Input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              {mode !== 'forgot' && (
                <Input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="Mật khẩu (tối thiểu 8 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Mật khẩu" />
              )}
              <Button type="submit" tone="info" disabled={busy}>
                {mode === 'signin' ? 'Đăng nhập' : mode === 'signup' ? 'Tạo tài khoản' : 'Gửi email đặt lại mật khẩu'}
              </Button>
              <div className="flex justify-between text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                {mode === 'signin'
                  ? <button type="button" onClick={() => setMode('signup')}>Chưa có tài khoản? Đăng ký</button>
                  : <button type="button" onClick={() => setMode('signin')}>← Đăng nhập</button>}
                {mode === 'signin' && <button type="button" onClick={() => setMode('forgot')}>Quên mật khẩu?</button>}
              </div>
            </motion.form>
          </AnimatePresence>
        )}
        <div className="flex flex-col items-center -mb-2"><OpenReplayFileButton>📂 Xem file replay (không cần đăng nhập)</OpenReplayFileButton></div>
      </Panel>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Account chip (lobby header) + account modal
// ---------------------------------------------------------------------------
function Avatar({ profile, user, size = 32 }) {
  const url = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const letter = (profile?.display_name || '?').trim().charAt(0).toUpperCase();
  return url
    ? <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{ borderRadius: '50%', width: size, height: size, objectFit: 'cover' }} />
    : <span className="inline-flex items-center justify-center font-black" aria-hidden="true"
        style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontSize: size * 0.45 }}>{letter}</span>;
}

export function AccountButton() {
  const { profile, user, enabled } = useAuthStore();
  const [open, setOpen] = useState(false);
  if (!enabled || !user) return null;
  const guest = user.is_anonymous;
  return (
    <>
      <button onClick={() => setOpen(true)} className="focusable flex items-center gap-2 pl-1 pr-3 py-1 shrink-0"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)' }}
        aria-label="Tài khoản">
        <Avatar profile={profile} user={user} size={30} />
        <span className="font-extrabold text-sm max-w-[9rem] truncate">{profile?.display_name || '…'}</span>
        {guest && <Badge tone="danger">Khách</Badge>}
      </button>
      <AccountModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function AccountModal({ open, onClose }) {
  const auth = useAuthStore();
  const { profile, user } = auth;
  const guest = Boolean(user?.is_anonymous);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Refill the form each time the modal opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDisplayName(profile?.display_name || ''); setUsername(profile?.username || '');
    setError(''); setInfo('');
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const run = async (fn) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); } finally { setBusy(false); }
  };
  const saveProfile = (e) => {
    e.preventDefault();
    run(async () => {
      const err = await auth.updateProfile({ display_name: displayName.trim(), username: username.trim() });
      if (err) setError(err); else setInfo('Đã lưu hồ sơ.');
    });
  };
  const link = (p) => run(async () => setError(await auth.linkProvider(p)));
  const upgrade = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await auth.upgradeWithEmail(email, password);
      if (r.error) setError(r.error);
      else setInfo(r.needsConfirmation
        ? 'Đã gửi email xác nhận. Mở link trong email để hoàn tất lưu tài khoản.'
        : 'Đã lưu tài khoản! Lịch sử chơi của bạn được giữ nguyên.');
    });
  };
  const signOut = () => {
    if (guest && !window.confirm('Đăng xuất tài khoản khách sẽ mất tài khoản này (trừ khi bạn đã lưu). Tiếp tục?')) return;
    onClose();
    auth.signOut();
  };

  const provider = user?.app_metadata?.provider;
  return (
    <Modal open={open} onClose={onClose} title="Tài khoản" maxWidth={420}>
      <div className="flex flex-col gap-4 overflow-y-auto -mx-1 px-1" style={{ maxHeight: 'calc(100dvh - 130px)' }}>
        <div className="flex items-center gap-3">
          <Avatar profile={profile} user={user} size={44} />
          <div className="flex flex-col text-left min-w-0">
            <span className="font-extrabold truncate">{profile?.display_name}</span>
            <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>
              {guest ? 'Tài khoản khách' : (user?.email || provider)}
            </span>
          </div>
        </div>

        <Notice tone="error">{error}</Notice>
        <Notice tone="info">{info}</Notice>

        <form onSubmit={saveProfile} className="flex flex-col gap-2 text-left">
          <label className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Tên hiển thị</label>
          <Input value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} />
          <label className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Tên đăng nhập</label>
          <Input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value)} />
          <Button type="submit" variant="soft" tone="accent" size="sm" disabled={busy}>Lưu hồ sơ</Button>
        </form>

        {guest && (
          <div className="flex flex-col gap-2.5 p-3" style={{ background: 'var(--accent-soft)', borderRadius: 'var(--radius)' }}>
            <div className="text-sm font-extrabold" style={{ color: 'var(--accent-ink)' }}>Lưu tài khoản khách</div>
            <p className="text-xs" style={{ color: 'var(--accent-ink)' }}>Giữ nguyên tên, lịch sử và replay; đăng nhập lại được trên thiết bị khác.</p>
            <ProviderButtons onClick={link} busy={busy} verb="Lưu" />
            <form onSubmit={upgrade} className="flex flex-col gap-2">
              <Input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input type="password" required minLength={8} placeholder="Mật khẩu (tối thiểu 8 ký tự)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="submit" tone="info" size="sm" disabled={busy}>Lưu bằng email</Button>
            </form>
          </div>
        )}

        <Button variant="outline" tone="danger" onClick={signOut}>Đăng xuất</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Set a new password after following a reset email
// ---------------------------------------------------------------------------
export function NewPasswordModal() {
  const { recovering, setNewPassword } = useAuthStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(await setNewPassword(password));
    setBusy(false);
  };
  return (
    <Modal open={recovering} onClose={() => {}} title="Đặt mật khẩu mới" maxWidth={380}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Notice tone="error">{error}</Notice>
        <Input type="password" required minLength={8} autoComplete="new-password" placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" tone="info" disabled={busy}>Lưu mật khẩu</Button>
      </form>
    </Modal>
  );
}

export function AuthLoading() {
  return (
    <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-2)' }}>
      <div className="board-spinner" aria-hidden="true" />
      <div className="text-sm font-semibold">Đang tải tài khoản…</div>
    </div>
  );
}
