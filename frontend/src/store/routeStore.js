import { create } from 'zustand';

// Minimal client-side routing for the few non-lobby screens:
//   /replay/<matchId>   replay of one of my matches
//   /replay/file        replay opened from a .catanreplay file
//   /r/<token>          shared replay link (no account needed)
//   /admin[/<tab>]      admin site (permission monitor.view)
export function parseRoute(path) {
  let m = /^\/admin(?:\/([a-z]+))?\/?$/.exec(path);
  if (m) return { kind: 'admin', tab: m[1] || 'overview' };
  m = /^\/replay\/file\/?$/.exec(path);
  if (m) return { kind: 'file' };
  m = /^\/replay\/([0-9a-f-]{36})\/?$/i.exec(path);
  if (m) return { kind: 'match', id: m[1] };
  m = /^\/r\/([A-Za-z0-9_-]{8,64})\/?$/.exec(path);
  if (m) return { kind: 'share', token: m[1] };
  return null;
}

export const useRoute = create((set) => ({
  path: window.location.pathname,
  navigate: (path) => {
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    set({ path });
  },
}));

window.addEventListener('popstate', () => useRoute.setState({ path: window.location.pathname }));
