import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Without these env vars the app runs in the old name-only mode (no login),
// so local development without a Supabase stack keeps working.
export const authEnabled = Boolean(url && anonKey);

export const supabase = authEnabled
  ? createClient(url, anonKey, {
      auth: {
        flowType: 'pkce',          // OAuth / magic link / recovery return ?code=…, exchanged automatically
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
