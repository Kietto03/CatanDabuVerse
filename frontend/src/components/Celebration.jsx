import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

const CONFETTI_COLORS = ['#c9852b', '#2f5fd6', '#d64545', '#16a34a', '#e08a1e', '#8b5cf6'];

function Confetti() {
  const bits = React.useMemo(
    () => [...Array(28)].map(() => ({
      angle: Math.random() * Math.PI * 2,
      dist: 90 + Math.random() * 160,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 7,
      rot: Math.random() * 720 - 360,
      delay: Math.random() * 0.1,
    })),
    []
  );
  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none">
      {bits.map((b, i) => (
        <motion.div
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: Math.cos(b.angle) * b.dist, y: Math.sin(b.angle) * b.dist + 40, opacity: 0, rotate: b.rot }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: b.delay }}
          style={{ position: 'absolute', width: b.size, height: b.size * 0.6, background: b.color, borderRadius: 2 }}
        />
      ))}
    </div>
  );
}

export default function Celebration() {
  const gameState = useGameStore((s) => s.gameState);
  const prev = useRef(null);
  const [event, setEvent] = useState(null); // {title, icon, name, color}
  const timer = useRef(null);

  useEffect(() => {
    if (!gameState) return;
    const nameOf = (idx) => gameState.slots[idx]?.username || 'Someone';
    const colorOf = (idx) => gameState.slots[idx]?.color || '#c9852b';

    const cur = {
      road: gameState.longestRoadHolder ?? null,
      army: gameState.largestArmyHolder ?? null,
      metro: gameState.metropolisHolders || {},
    };
    const p = prev.current;
    if (p) {
      const fire = (title, icon, idx) => {
        if (idx == null) return;
        setEvent({ title, icon, name: nameOf(idx), color: colorOf(idx) });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setEvent(null), 2800);
      };
      if (cur.road != null && cur.road !== p.road) fire('Đường dài nhất', '🛣️', cur.road);
      else if (cur.army != null && cur.army !== p.army) fire('Đạo quân lớn nhất', '⚔️', cur.army);
      else {
        for (const t of ['trade', 'politics', 'science']) {
          if (cur.metro[t] != null && cur.metro[t] !== (p.metro?.[t] ?? null)) {
            fire(`Metropolis ${t[0].toUpperCase() + t.slice(1)}`, '🏛️', cur.metro[t]);
            break;
          }
        }
      }
    }
    prev.current = cur;
  }, [gameState]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-start justify-center pointer-events-none"
          style={{ zIndex: 55, paddingTop: '18vh' }}
        >
          <motion.div
            initial={{ scale: 0.5, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="relative panel px-7 py-5 flex flex-col items-center gap-1 text-center"
            style={{ boxShadow: 'var(--shadow-3)' }}
          >
            <Confetti />
            <div className="text-4xl" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.2))' }}>{event.icon}</div>
            <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{event.title}</div>
            <div className="text-lg font-extrabold" style={{ color: event.color }}>{event.name}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
