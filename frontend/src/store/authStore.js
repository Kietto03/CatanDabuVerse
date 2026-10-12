import { create } from 'zustand';
import { supabase, authEnabled } from '../lib/supabase';

// Supabase Auth error codes → Vietnamese messages shown in the UI.
const ERRORS = {
  invalid_credentials: 'Email hoặc mật khẩu không đúng.',
  email_not_confirmed: 'Email chưa được xác nhận. Kiểm tra hộp thư của bạn.',
  user_already_exists: 'Email này đã có tài khoản.',
  email_exists: 'Email này đã có tài khoản.',
  weak_password: 'Mật khẩu quá yếu (tối thiểu 8 ký tự).',
  over_email_send_rate_limit: 'Gửi email quá nhiều lần, thử lại sau ít phút.',
  over_request_rate_limit: 'Thao tác quá nhanh, thử lại sau ít phút.',
  identity_already_exists: 'Tài khoản Google/Discord này đã gắn với người chơi khác.',
  same_password: 'Mật khẩu mới phải khác mật khẩu cũ.',
  anonymous_provider_disabled: 'Chế độ chơi khách đang tắt.',
};
export function authErrorMessage(err) {
  if (!err) return '';
  if (err.code && ERRORS[err.code]) return ERRORS[err.code];
  if (err.code === '23505') return 'Tên đăng nhập này đã có người dùng.';
  if (err.code === '23514') return 'Tên đăng nhập chỉ gồm chữ, số, "_" và dài 3–20 ký tự.';
  return err.message || 'Đã có lỗi xảy ra.';
}

// Roles/permissions are added to the access token by the database hook
// (public.custom_access_token_hook). Read them for UI decisions only; the
// server and RLS enforce them.
function decodeClaims(session) {
  try {
    const payload = session.access_token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

// Where OAuth / email links send the user back: the current page (keeps ?room=ABCD).
const returnUrl = () => window.location.origin + window.location.pathname + window.location.search;

export const useAuthStore = create((set, get) => ({
  enabled: authEnabled,
  ready: !authEnabled,       // true once the initial session check is done
  session: null,
  user: null,
  profile: null,
  roles: [],
  permissions: [],
  recovering: false,         // arrived from a password-reset email
  urlError: '',              // error returned by an OAuth redirect

  init: () => {
    if (!authEnabled) return;
    const params = new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, '&'));
    const urlError = params.get('error_description');
    if (urlError) {
      set({ urlError });
      window.history.replaceState(null, '', window.location.pathname);
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') set({ recovering: true });
      // Supabase calls inside this callback can deadlock on the auth lock; defer them.
      setTimeout(() => get()._applySession(session), 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      get()._applySession(data.session).finally(() => set({ ready: true }));
    });
  },

  _applySession: async (session) => {
    const prevUser = get().user?.id;
    const claims = session ? decodeClaims(session) : {};
    set({
      session,
      user: session?.user ?? null,
      roles: claims.app_roles || [],
      permissions: claims.app_permissions || [],
    });
    if (!session) { set({ profile: null }); return; }
    // The profile only needs reloading when the user changes (not on token refresh).
    if (session.user.id !== prevUser || !get().profile) await get().loadProfile();
  },

  loadProfile: async () => {
    const user = get().user;
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, is_guest')
      .eq('id', user.id)
      .single();
    if (!error) set({ profile: data });
  },

  // Display name used as the in-game seat name until the server keys seats by user id (roadmap step 3).
  playerName: () => get().profile?.display_name || '',
  isGuest: () => Boolean(get().user?.is_anonymous),
  can: (perm) => {
    const p = get().permissions;
    return p.includes(perm) || p.includes('*');
  },

  // ---- sign-in methods (each returns an error message or '') ----
  signInWithProvider: async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl() } });
    return authErrorMessage(error);
  },

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return authErrorMessage(error);
  },

  // Returns { error, needsConfirmation }.
  signUpWithEmail: async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name }, emailRedirectTo: returnUrl() },
    });
    return { error: authErrorMessage(error), needsConfirmation: !error && !data.session };
  },

  signInAsGuest: async (name) => {
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { name } } });
    return authErrorMessage(error);
  },

  sendPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: returnUrl() });
    return authErrorMessage(error);
  },

  setNewPassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) set({ recovering: false });
    return authErrorMessage(error);
  },

  // ---- guest → permanent account (same user id, history kept) ----
  linkProvider: async (provider) => {
    const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: returnUrl() } });
    return authErrorMessage(error);
  },

  // Adds email + password to a guest. Returns { error, needsConfirmation }.
  upgradeWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.updateUser({ email, password }, { emailRedirectTo: returnUrl() });
    if (error) return { error: authErrorMessage(error), needsConfirmation: false };
    // With email confirmation on, the user stays anonymous until the link is clicked.
    const upgraded = data.user && !data.user.is_anonymous;
    if (upgraded) await get().refreshClaims();
    return { error: '', needsConfirmation: !upgraded };
  },

  // Role changes (e.g. guest → player) only reach the JWT on refresh.
  refreshClaims: async () => {
    const { data } = await supabase.auth.refreshSession();
    if (!data.session) return get()._applySession(null);
    await get()._applySession(data.session);
    await get().loadProfile();
  },

  updateProfile: async (fields) => {
    const { data, error } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', get().user.id)
      .select('id, username, display_name, avatar_url, is_guest')
      .single();
    if (!error) set({ profile: data });
    return authErrorMessage(error);
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, roles: [], permissions: [] });
  },

  clearUrlError: () => set({ urlError: '' }),
}));

if (typeof window !== 'undefined') {
  window.useAuthStore = useAuthStore;
}
