import { create } from 'zustand';
import { io } from 'socket.io-client';
import { useAuthStore } from './authStore';
import { supabase } from '../lib/supabase';

// Sound FX Synthesis Helper
let audioCtx = null;
function playSound(type) {
  if (typeof window === 'undefined') return;
  try {
    if (useGameStore.getState().muteSound) return;
  } catch (e) {}
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;

  if (type === 'roll') {
    const duration = 0.45;
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(now);
  } else if (type === 'build') {
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4 -> E4 -> G4 -> C5
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      
      gain.gain.setValueAtTime(0.12, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.12);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.2);
    });
  } else if (type === 'error') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.linearRampToValueAtTime(90, now + 0.18);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

// Zustand Game Store
export const useGameStore = create((set, get) => {
  // The Supabase access token is sent on every (re)connect, so a refreshed
  // token is picked up automatically; the server verifies it.
  const makeSocket = (url) => io(url, {
    autoConnect: false,
    auth: (cb) => cb({ token: useAuthStore.getState().session?.access_token ?? null }),
  });
  let socket = makeSocket(window.location.origin);
  let skipAutoJoin = false;

  // While a replay is on screen nothing may reach the server (the board's click
  // handlers still call the normal actions), and live updates must not replace it.
  const emit = (...args) => { if (!get().replayMode) socket.emit(...args); };

  // ---- Multi-server routing (needs Supabase; otherwise everything stays on this origin) ----
  const routing = Boolean(supabase);
  const rpc = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data || [];
  };
  const sameServer = (url) => new URL(url, window.location.href).origin === new URL(socket.io.uri, window.location.href).origin;

  // Move the live connection to another game server (keeps all listeners).
  const switchServer = (url) => {
    if (!url || sameServer(url)) return false;
    socket.off();
    socket.io.off();
    socket.disconnect();
    socket = makeSocket(url);
    bind(socket);
    set(get().replayMode ? { liveSocket: socket } : { socket, liveSocket: socket });
    if (useAuthStore.getState().session || !useAuthStore.getState().enabled) socket.connect();
    return true;
  };

  // Find which server owns a live room and connect there.
  const routeToRoom = async (code) => {
    if (!routing || !code) return null;
    try {
      const [row] = await rpc('find_room', { p_code: code });
      if (row) switchServer(row.server_url);
      return row || null;
    } catch (e) {
      console.warn('find_room failed', e);
      return null;
    }
  };

  // After an unexpected disconnect, poll the room directory: if another server
  // took the room over, follow it there. Stops once connected again.
  let followTimer = null;
  const stopFollowing = () => { clearInterval(followTimer); followTimer = null; };
  const followRoom = () => {
    const code = localStorage.getItem('catan_room_code');
    if (!routing || !code || followTimer) return;
    followTimer = setInterval(async () => {
      if (socket.connected) return stopFollowing();
      const row = await routeToRoom(code);
      if (row && !socket.connected && sameServer(row.server_url)) socket.connect();
    }, 3000);
  };

  // Connect when someone signs in, disconnect on sign-out, reconnect when the
  // account changes. Token refreshes for the same user don't need a reconnect.
  useAuthStore.subscribe(async (auth, prev) => {
    const uid = auth.ready ? (auth.session?.user?.id ?? null) : undefined;
    const prevUid = prev.ready ? (prev.session?.user?.id ?? null) : undefined;
    if (uid === prevUid) return;
    if (prevUid) {
      // A different person on this browser must not auto-rejoin the previous seat.
      localStorage.removeItem('catan_room_code');
      localStorage.removeItem('catan_username');
      localStorage.removeItem('catan_token');
      set({ gameState: null });
    }
    stopFollowing();
    if (socket.connected) socket.disconnect();
    if (uid) {
      // Rejoining after a reload: go straight to the server that owns the room.
      await routeToRoom(localStorage.getItem('catan_room_code'));
      if (!socket.connected) socket.connect();
    }
  });

  function bind(s) {
    // Bind WebSockets observers
    s.on('gameState', (state) => {
      if (!get().replayMode) set({ gameState: state });
    });

    // An admin ended the match: back to the lobby, and don't auto-rejoin it.
    s.on('roomClosed', ({ reason }) => {
      localStorage.removeItem('catan_room_code');
      localStorage.removeItem('catan_token');
      set({ gameState: null, toastMsg: reason });
      setTimeout(() => { if (get().toastMsg === reason) set({ toastMsg: '' }); }, 6000);
    });

    s.on('sound', (type) => {
      playSound(type);
    });

    // Private session token used to prove seat ownership on reconnect.
    s.on('session', ({ token }) => {
      if (token) localStorage.setItem('catan_token', token);
    });

    s.on('errorMsg', (msg) => {
      set({ toastMsg: msg });
      playSound('error');
      setTimeout(() => {
        if (get().toastMsg === msg) {
          set({ toastMsg: '' });
        }
      }, 3000);
    });

    s.on('connect', () => {
      set({ connected: true });
      stopFollowing();
      if (skipAutoJoin) { skipAutoJoin = false; return; }   // a create/join is already queued
      const savedCode = localStorage.getItem('catan_room_code');
      const savedUsername = localStorage.getItem('catan_username');
      const savedToken = localStorage.getItem('catan_token');
      // With accounts the server identifies the seat by user id; the name only matters without login.
      if (savedCode && (savedUsername || useAuthStore.getState().enabled)) {
        console.log(`Auto-reconnecting to room ${savedCode} as ${savedUsername}...`);
        emit('joinRoom', { roomCode: savedCode, username: savedUsername, token: savedToken });
      }
    });

    // The server refuses sockets without a valid login (socket.io won't retry those).
    // An expired token gets one refresh + retry; a ban signs out with the reason.
    let authRetried = false;
    s.on('connect', () => { authRetried = false; });
    s.on('connect_error', async (err) => {
      const auth = useAuthStore.getState();
      if (err.message === 'banned') {
        const ban = err.data || {};
        const until = ban.until ? ` đến ${ban.until}` : ' vĩnh viễn';
        useAuthStore.setState({ urlError: `Tài khoản đã bị khoá${until}. Lý do: ${ban.reason || '—'}` });
        await auth.signOut();
      } else if (err.message === 'unauthorized') {
        if (!authRetried) {
          authRetried = true;
          await auth.refreshClaims();
          if (useAuthStore.getState().session) s.connect();
        } else {
          useAuthStore.setState({ urlError: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' });
          await auth.signOut();
        }
      }
    });

    // Surface the live connection status so the UI can show a "reconnecting" overlay.
    // An intentional disconnect (sign-out / account switch) is not a lost connection.
    s.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        set({ connected: false });
        followRoom();   // the room may have moved to another server (failover)
      }
    });
    s.io.on('reconnect_attempt', () => {
      set({ connected: false });
    });
  }
  bind(socket);
  if (!useAuthStore.getState().enabled) socket.connect();   // no login: connect right away

  return {
    socket,
    gameState: null,
    // socket.io connects eagerly; start optimistic so we don't flash the overlay
    // before the first `connect` fires, then track real state thereafter.
    connected: true,
    toastMsg: '',
    // Default-collapsed on narrow viewports so the floating panels don't cover
    // the board on phones/tablets; open by default on desktop.
    chatCollapsed: typeof window !== 'undefined' && window.innerWidth < 900,
    muteSound: false,
    // Board placement mode for expansion pieces: null | {kind:'ship'|'knight'|'merchant'|'moveShipFrom'|'moveShipTo'|'moveKnightFrom'|'moveKnightTo', data}
    placementMode: null,
    // Replay viewer: `socket` is swapped for { id: 'seat-N' | 'spectator' } so the
    // normal components render "as" that seat; the real socket stays in `liveSocket`.
    replayMode: false,
    liveSocket: socket,
    setPlacementMode: (mode) => set({ placementMode: mode }),
    clearPlacementMode: () => set({ placementMode: null }),
    toggleChat: () => set((state) => ({ chatCollapsed: !state.chatCollapsed })),
    toggleMute: () => set((state) => ({ muteSound: !state.muteSound })),
    
    createRoom: async (roomCode, username, gameMode, hideBankCards, balancedDice, victoryPointsLimit, turnTimeoutLimit, slots, mapId) => {
      if (routing) {
        // New rooms go to the least-loaded healthy server.
        let row;
        try { [row] = await rpc('pick_game_server', {}); } catch (e) { console.warn('pick_game_server failed', e); }
        if (row === undefined && routing) {
          set({ toastMsg: 'Không có máy chủ game nào sẵn sàng, thử lại sau.' });
          return;
        }
        if (switchServer(row.server_url)) skipAutoJoin = true;
      }
      localStorage.removeItem('catan_token'); // fresh seat, discard any stale token
      localStorage.setItem('catan_room_code', roomCode);
      localStorage.setItem('catan_username', username);
      emit('createRoom', { roomCode, username, gameMode, hideBankCards, balancedDice, victoryPointsLimit, turnTimeoutLimit, slots, mapId });
    },

    joinRoom: async (roomCode, username) => {
      const before = socket;
      await routeToRoom(roomCode);
      if (socket !== before) skipAutoJoin = true;
      // Only forward a saved token when rejoining the same room+name it was issued for.
      const prevCode = localStorage.getItem('catan_room_code');
      const prevUser = localStorage.getItem('catan_username');
      const token = (prevCode === roomCode && prevUser === username)
        ? localStorage.getItem('catan_token')
        : null;
      if (!token) localStorage.removeItem('catan_token');
      localStorage.setItem('catan_room_code', roomCode);
      localStorage.setItem('catan_username', username);
      emit('joinRoom', { roomCode, username, token });
    },

    startGame: () => {
      emit('startGame');
    },

    buildSettlement: (vertexId) => {
      emit('buildSettlement', vertexId);
    },

    buildCity: (vertexId) => {
      emit('buildCity', vertexId);
    },

    buyDevCard: () => {
      emit('buyDevCard');
    },

    buildRoad: (edgeId) => {
      emit('buildRoad', edgeId);
    },

    rollDice: () => {
      emit('rollDice');
    },

    bankTrade: (offer, demand) => {
      emit('bankTrade', { offer, demand });
    },

    submitDiscard: (discardedCards) => {
      emit('submitDiscard', discardedCards);
    },

    moveRobber: (q, r, targetPlayerIndex) => {
      emit('moveRobber', { q, r, targetPlayerIndex });
    },

    // --- Seafarers ---
    movePirate: (q, r, targetPlayerIndex) => {
      emit('movePirate', { q, r, targetPlayerIndex });
    },

    buildShip: (edgeId) => {
      emit('buildShip', edgeId);
    },

    moveShip: (fromEdgeId, toEdgeId) => {
      emit('moveShip', { from: fromEdgeId, to: toEdgeId });
    },

    chooseGold: (picks) => {
      emit('chooseGold', { picks });
    },

    // --- Cities & Knights ---
    upgradeCityImprovement: (track) => {
      emit('upgradeCityImprovement', { track });
    },

    buildCityWall: () => {
      emit('buildCityWall');
    },

    buildKnight: (vertexId) => {
      emit('buildKnight', vertexId);
    },

    activateKnight: (vertexId) => {
      emit('activateKnight', vertexId);
    },

    promoteKnight: (vertexId) => {
      emit('promoteKnight', vertexId);
    },

    moveKnight: (fromVertexId, toVertexId) => {
      emit('moveKnight', { from: fromVertexId, to: toVertexId });
    },

    chaseRobber: (vertexId) => {
      emit('chaseRobber', vertexId);
    },

    // card = card name; extra params per card, e.g. {resource}, {commodity}, {d1,d2}
    playProgressCard: (card, params = {}) => {
      emit('playProgressCard', { card, ...params });
    },

    endTurn: () => {
      emit('endTurn');
    },

    playDevCard: (cardType, data = {}) => {
      emit('playDevCard', { cardType, ...data });
    },

    proposeTrade: (offer, demand) => {
      emit('proposeTrade', { offer, demand });
    },

    acceptTrade: () => {
      emit('acceptTrade');
    },

    counterTrade: (offer, demand) => {
      emit('counterTrade', { offer, demand });
    },

    cancelTrade: () => {
      emit('cancelTrade');
    },

    executeTrade: (targetPlayerIndex) => {
      emit('executeTrade', { targetIndex: targetPlayerIndex });
    },

    toggleReady: () => {
      emit('toggleReady');
    },

    cycleColor: (slotIdx) => {
      emit('cycleColor', slotIdx);
    },

    switchSlot: (targetIdx) => {
      emit('switchSlot', targetIdx);
    },

    exitGame: () => {
      localStorage.removeItem('catan_room_code');
      localStorage.removeItem('catan_username');
      localStorage.removeItem('catan_token');
      set({ gameState: null });
      window.location.href = "/";
    },

    clearToast: () => set({ toastMsg: '' })
  };
});

if (typeof window !== 'undefined') {
  window.useGameStore = useGameStore;
}
