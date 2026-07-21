import React, { Suspense, lazy } from 'react';
import { MotionConfig } from 'framer-motion';
import { useGameStore } from './store/gameStore';
import Lobby from './components/Lobby';
import Scoreboard from './components/Scoreboard';
import PlayerDashboard from './components/PlayerDashboard';
import ChatWidget from './components/ChatWidget';
import LeftNavBar from './components/LeftNavBar';
import ExpansionPanel from './components/ExpansionPanel';
import Celebration from './components/Celebration';

// PixiJS (~big) is only needed once a game board is on screen. Lazy-loading it
// keeps the pixi chunk out of the initial lobby download.
const BoardCanvas = lazy(() => import('./components/BoardCanvas'));

function BoardFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-2)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="board-spinner" aria-hidden="true" />
        <div className="text-sm font-semibold">Đang tải bàn chơi…</div>
      </div>
    </div>
  );
}

function ReconnectOverlay() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--z-toast)', background: 'rgba(38,48,63,.45)', backdropFilter: 'blur(3px)' }}
      role="alert"
      aria-live="assertive"
    >
      <div className="panel flex flex-col items-center gap-3 py-6 px-8">
        <div className="board-spinner" aria-hidden="true" />
        <div className="font-bold" style={{ color: 'var(--text)' }}>Mất kết nối</div>
        <div className="text-sm" style={{ color: 'var(--text-2)' }}>Đang kết nối lại máy chủ…</div>
      </div>
    </div>
  );
}

function App() {
  const gameState = useGameStore((state) => state.gameState);
  const toastMsg = useGameStore((state) => state.toastMsg);
  const connected = useGameStore((state) => state.connected);

  const inGame = gameState && gameState.gameState !== 'lobby';

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen w-screen overflow-hidden flex items-center justify-center" style={{ color: 'var(--text)' }}>
        {/* Toast Alert */}
        {toastMsg && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 font-bold py-3 px-6"
               style={{ zIndex: 'var(--z-toast)', background: 'var(--danger)', color: '#fff', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-3)' }}
               role="status" aria-live="polite">
            {toastMsg}
          </div>
        )}

        {/* Connection lost overlay (socket dropped / reconnecting) */}
        {!connected && <ReconnectOverlay />}

        {/* Screen Router */}
        {!inGame ? (
          <Lobby />
        ) : (
          <div className="relative h-screen w-screen overflow-hidden select-none">
            {/* Main Map Area takes full screen */}
            <div className="absolute inset-0 w-full h-full z-0">
              <Suspense fallback={<BoardFallback />}>
                <BoardCanvas />
              </Suspense>
            </div>

            {/* Top Bar: Compact Player Roster */}
            <div className="absolute top-0 left-0 w-full pointer-events-none" style={{ zIndex: 'var(--z-panel)' }}>
              <div className="pointer-events-auto">
                <Scoreboard />
              </div>
            </div>

            {/* Far Left Navigation Utility Bar */}
            <div className="absolute left-0 top-0 bottom-0 w-14 sm:w-16" style={{ zIndex: 'var(--z-float)' }}>
              <LeftNavBar />
            </div>

            {/* Floating Left: Collapsible ChatWidget next to LeftNavBar */}
            <div className="absolute top-20 sm:top-24 left-16 sm:left-20 pointer-events-none" style={{ zIndex: 'var(--z-panel)' }}>
              <div className="pointer-events-auto">
                <ChatWidget />
              </div>
            </div>

            {/* Floating Right: Expansion controls (Cities & Knights / Seafarers) */}
            <div className="absolute top-16 sm:top-20 right-2 sm:right-3 pointer-events-none" style={{ zIndex: 'var(--z-panel)' }}>
              <div className="pointer-events-auto">
                <ExpansionPanel />
              </div>
            </div>

            {/* Achievement celebration overlay */}
            <Celebration />

            {/* Floating center & action buttons are handled inside PlayerDashboard */}
            <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ zIndex: 'var(--z-panel)' }}>
              <div className="pointer-events-auto">
                <PlayerDashboard />
              </div>
            </div>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

export default App;
