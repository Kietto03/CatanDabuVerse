import { create } from 'zustand';
import { io } from 'socket.io-client';

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
  const socket = io(window.location.origin);

  // Bind WebSockets observers
  socket.on('gameState', (state) => {
    set({ gameState: state });
  });

  socket.on('sound', (type) => {
    playSound(type);
  });

  // Private session token used to prove seat ownership on reconnect.
  socket.on('session', ({ token }) => {
    if (token) localStorage.setItem('catan_token', token);
  });

  socket.on('errorMsg', (msg) => {
    set({ toastMsg: msg });
    playSound('error');
    setTimeout(() => {
      if (get().toastMsg === msg) {
        set({ toastMsg: '' });
      }
    }, 3000);
  });

  socket.on('connect', () => {
    set({ connected: true });
    const savedCode = localStorage.getItem('catan_room_code');
    const savedUsername = localStorage.getItem('catan_username');
    const savedToken = localStorage.getItem('catan_token');
    if (savedCode && savedUsername) {
      console.log(`Auto-reconnecting to room ${savedCode} as ${savedUsername}...`);
      socket.emit('joinRoom', { roomCode: savedCode, username: savedUsername, token: savedToken });
    }
  });

  // Surface the live connection status so the UI can show a "reconnecting" overlay.
  socket.on('disconnect', () => {
    set({ connected: false });
  });
  socket.io.on('reconnect_attempt', () => {
    set({ connected: false });
  });

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
    setPlacementMode: (mode) => set({ placementMode: mode }),
    clearPlacementMode: () => set({ placementMode: null }),
    toggleChat: () => set((state) => ({ chatCollapsed: !state.chatCollapsed })),
    toggleMute: () => set((state) => ({ muteSound: !state.muteSound })),
    
    createRoom: (roomCode, username, gameMode, hideBankCards, balancedDice, victoryPointsLimit, turnTimeoutLimit, slots, mapId) => {
      localStorage.removeItem('catan_token'); // fresh seat, discard any stale token
      localStorage.setItem('catan_room_code', roomCode);
      localStorage.setItem('catan_username', username);
      socket.emit('createRoom', { roomCode, username, gameMode, hideBankCards, balancedDice, victoryPointsLimit, turnTimeoutLimit, slots, mapId });
    },

    joinRoom: (roomCode, username) => {
      // Only forward a saved token when rejoining the same room+name it was issued for.
      const prevCode = localStorage.getItem('catan_room_code');
      const prevUser = localStorage.getItem('catan_username');
      const token = (prevCode === roomCode && prevUser === username)
        ? localStorage.getItem('catan_token')
        : null;
      if (!token) localStorage.removeItem('catan_token');
      localStorage.setItem('catan_room_code', roomCode);
      localStorage.setItem('catan_username', username);
      socket.emit('joinRoom', { roomCode, username, token });
    },

    startGame: () => {
      socket.emit('startGame');
    },

    buildSettlement: (vertexId) => {
      socket.emit('buildSettlement', vertexId);
    },

    buildCity: (vertexId) => {
      socket.emit('buildCity', vertexId);
    },

    buyDevCard: () => {
      socket.emit('buyDevCard');
    },

    buildRoad: (edgeId) => {
      socket.emit('buildRoad', edgeId);
    },

    rollDice: () => {
      socket.emit('rollDice');
    },

    bankTrade: (offer, demand) => {
      socket.emit('bankTrade', { offer, demand });
    },

    submitDiscard: (discardedCards) => {
      socket.emit('submitDiscard', discardedCards);
    },

    moveRobber: (q, r, targetPlayerIndex) => {
      socket.emit('moveRobber', { q, r, targetPlayerIndex });
    },

    // --- Seafarers ---
    movePirate: (q, r, targetPlayerIndex) => {
      socket.emit('movePirate', { q, r, targetPlayerIndex });
    },

    buildShip: (edgeId) => {
      socket.emit('buildShip', edgeId);
    },

    moveShip: (fromEdgeId, toEdgeId) => {
      socket.emit('moveShip', { from: fromEdgeId, to: toEdgeId });
    },

    chooseGold: (picks) => {
      socket.emit('chooseGold', { picks });
    },

    // --- Cities & Knights ---
    upgradeCityImprovement: (track) => {
      socket.emit('upgradeCityImprovement', { track });
    },

    buildCityWall: () => {
      socket.emit('buildCityWall');
    },

    buildKnight: (vertexId) => {
      socket.emit('buildKnight', vertexId);
    },

    activateKnight: (vertexId) => {
      socket.emit('activateKnight', vertexId);
    },

    promoteKnight: (vertexId) => {
      socket.emit('promoteKnight', vertexId);
    },

    moveKnight: (fromVertexId, toVertexId) => {
      socket.emit('moveKnight', { from: fromVertexId, to: toVertexId });
    },

    chaseRobber: (vertexId) => {
      socket.emit('chaseRobber', vertexId);
    },

    // card = card name; extra params per card, e.g. {resource}, {commodity}, {d1,d2}
    playProgressCard: (card, params = {}) => {
      socket.emit('playProgressCard', { card, ...params });
    },

    endTurn: () => {
      socket.emit('endTurn');
    },

    playDevCard: (cardType, data = {}) => {
      socket.emit('playDevCard', { cardType, ...data });
    },

    proposeTrade: (offer, demand) => {
      socket.emit('proposeTrade', { offer, demand });
    },

    acceptTrade: () => {
      socket.emit('acceptTrade');
    },

    counterTrade: (offer, demand) => {
      socket.emit('counterTrade', { offer, demand });
    },

    cancelTrade: () => {
      socket.emit('cancelTrade');
    },

    executeTrade: (targetPlayerIndex) => {
      socket.emit('executeTrade', { targetIndex: targetPlayerIndex });
    },

    toggleReady: () => {
      socket.emit('toggleReady');
    },

    cycleColor: (slotIdx) => {
      socket.emit('cycleColor', slotIdx);
    },

    switchSlot: (targetIdx) => {
      socket.emit('switchSlot', targetIdx);
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
