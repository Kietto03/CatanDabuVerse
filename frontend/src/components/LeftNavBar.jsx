import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

function NavIcon({ active, onClick, title, children }) {
  return (
    <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.92 }} onClick={onClick} title={title}
      className="focusable relative z-10 flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer"
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--surface)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        color: active ? 'var(--accent-ink)' : 'var(--text-2)',
        boxShadow: 'var(--shadow-1)',
      }}>
      {children}
    </motion.button>
  );
}

function Popover({ children }) {
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}
      className="panel absolute left-14 top-0 p-4 w-56 z-50 text-left" style={{ color: 'var(--text)' }}>
      {children}
    </motion.div>
  );
}

const COSTS = [
  ['Đường 🛣️', 'tăng chuỗi đường dài', '🌲 🧱'],
  ['Làng 🏠', '1 điểm thắng', '🌲 🧱 🌾 🐑'],
  ['Thành 🏙️', '2 VP (nâng từ làng)', '🌾🌾 ⛰️⛰️⛰️'],
  ['Thẻ 📜', 'Knight / VP / progress', '🐑 🌾 ⛰️'],
];

function LeftNavBar() {
  const toggleChat = useGameStore((state) => state.toggleChat);
  const muteSound = useGameStore((state) => state.muteSound);
  const toggleMute = useGameStore((state) => state.toggleMute);
  const gameState = useGameStore((state) => state.gameState);
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const icon = (d) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );

  return (
    <div className="h-full w-full flex flex-col items-center gap-4 py-6 select-none relative"
      style={{ background: 'color-mix(in srgb, var(--surface) 88%, transparent)', backdropFilter: 'blur(8px)', borderRight: '1px solid var(--border)' }}>
      {/* Settings */}
      <div className="relative z-10">
        <NavIcon active={showSettings} title="Cài đặt" onClick={() => { setShowSettings(!showSettings); setShowInfo(false); }}>
          {icon('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.59c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827a1.125 1.125 0 0 1 .26 1.43l-1.297 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z')}
        </NavIcon>
        <AnimatePresence>
          {showSettings && (
            <Popover>
              <h4 className="text-[11px] font-black uppercase tracking-wider mb-3 pb-1.5" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>Cài đặt</h4>
              <label className="flex items-center justify-between text-xs font-extrabold cursor-pointer select-none">
                <span>Âm thanh</span>
                <button onClick={toggleMute} className="px-2 py-0.5 rounded text-[10px] uppercase font-black"
                  style={muteSound ? { background: '#fde8e8', color: '#9b1c1c' } : { background: '#e3f6e9', color: '#0f7a37' }}>
                  {muteSound ? 'Tắt 🔇' : 'Bật 🔊'}
                </button>
              </label>
              <div className="flex items-center justify-between text-xs font-bold pt-2 mt-2" style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)' }}>
                <span>Bộ xúc xắc</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-black" style={{ background: 'var(--surface-2)' }}>{gameState?.balancedDice ? 'Cân bằng' : 'Chuẩn'}</span>
              </div>
            </Popover>
          )}
        </AnimatePresence>
      </div>

      <NavIcon title="Chat & Nhật ký" onClick={toggleChat}>
        {icon('M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25')}
      </NavIcon>

      <NavIcon title="Toàn màn hình" onClick={toggleFullscreen}>
        {icon('M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15')}
      </NavIcon>

      <div className="relative z-10">
        <NavIcon active={showInfo} title="Chi phí xây dựng" onClick={() => { setShowInfo(!showInfo); setShowSettings(false); }}>
          {icon('M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.852l.041-.028M12 9h.008v.008H12V9zm9 3a9 9 0 11-18 0 9 9 0 0118 0z')}
        </NavIcon>
        <AnimatePresence>
          {showInfo && (
            <Popover>
              <h4 className="text-[11px] font-black uppercase tracking-wider mb-3 pb-1.5 flex justify-between items-center" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                <span>Chi phí xây</span>
                <button onClick={() => setShowInfo(false)} style={{ color: 'var(--muted)' }}>✕</button>
              </h4>
              <div className="flex flex-col gap-2.5 text-xs">
                {COSTS.map(([name, sub, cost], i) => (
                  <div key={i} className="flex items-center justify-between pb-1.5" style={{ borderBottom: i < COSTS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div className="flex flex-col">
                      <span className="font-extrabold">{name}</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>{sub}</span>
                    </div>
                    <span className="font-bold" style={{ color: 'var(--text-2)' }}>{cost}</span>
                  </div>
                ))}
              </div>
            </Popover>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default LeftNavBar;
