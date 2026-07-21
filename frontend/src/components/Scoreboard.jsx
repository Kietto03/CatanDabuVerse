import React from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { Button, Badge } from '../ui';

function Scoreboard() {
  const gameState = useGameStore((state) => state.gameState);
  const socket = useGameStore((state) => state.socket);
  const exitGame = useGameStore((state) => state.exitGame);

  if (!gameState) return null;

  const activePlayerIndex = gameState.currentPlayerIndex;
  const activePlayer = gameState.slots[activePlayerIndex];

  const statusSub =
    gameState.gameState === 'setup' ? `Đặt ${gameState.setupSubStep}`
    : gameState.gameState === 'gameover' ? `${gameState.winner} thắng!`
    : !gameState.diceRolled ? 'Chờ tung xúc xắc 🎲'
    : 'Xây dựng hoặc giao thương';

  return (
    <div
      className="w-full px-3 py-2 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap md:flex-nowrap select-none"
      style={{
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-1)',
      }}
    >
      {/* Left: room + controls + turn banner */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="font-black text-sm hidden sm:inline" style={{ color: 'var(--accent-ink)', letterSpacing: '.02em' }}>
          CATAN
        </span>
        <Badge tone="accent" style={{ fontSize: 11 }}>ROOM {gameState.code}</Badge>
        <Button variant="soft" tone="danger" size="sm" onClick={exitGame}>Rời 🚪</Button>

        <div className="hidden md:flex flex-col text-left pl-2.5" style={{ borderLeft: '1px solid var(--border)' }}>
          <span className="font-black text-xs" style={{ color: activePlayer?.color || 'var(--text)' }}>
            {gameState.gameState === 'setup' ? `Lượt đặt của ${activePlayer?.username}`
              : gameState.gameState === 'gameover' ? 'Kết thúc'
              : `Lượt của ${activePlayer?.username}`}
          </span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>{statusSub}</span>
        </div>
      </div>

      {/* Middle/Right: player roster — own full-width scroll row on mobile so barbarian tracker stays visible */}
      <div className="order-last w-full md:order-none md:w-auto md:flex-1 flex items-center gap-2 overflow-x-auto justify-start md:justify-end py-0.5">
        {gameState.slots.map((slot, idx) => {
          if (slot.type === 'empty' || !slot.username) return null;

          const isCurrent = activePlayerIndex === idx;
          const isMe = slot.id === socket.id;
          const totalRes = Object.values(slot.resources || {}).reduce((a, b) => a + b, 0);

          const builtSettlements = gameState.board.vertices.filter((v) => v.owner === slot.index && v.building === 'settlement').length;
          const builtCities = gameState.board.vertices.filter((v) => v.owner === slot.index && v.building === 'city').length;
          const builtRoads = gameState.board.edges.filter((e) => e.owner === slot.index).length;
          const settlementsLeft = Math.max(0, 5 - builtSettlements);
          const citiesLeft = Math.max(0, 4 - builtCities);
          const roadsLeft = Math.max(0, 15 - builtRoads);

          const hasLongestRoad = gameState.longestRoadHolder === slot.index;
          const hasLargestArmy = gameState.largestArmyHolder === slot.index;

          return (
            <motion.div
              key={idx}
              initial={false}
              animate={isCurrent
                ? { boxShadow: '0 0 0 2px var(--accent), var(--shadow-2)' }
                : { boxShadow: 'var(--shadow-1)' }}
              transition={{ duration: 0.3 }}
              className="min-w-[150px] max-w-[184px] p-2 flex flex-col gap-1 relative"
              style={{
                background: isCurrent ? 'var(--surface)' : 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              {isCurrent && (
                <motion.span
                  initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }}
                  className="absolute -top-2 -right-1.5 font-black text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow-1)' }}
                >
                  Đang chơi
                </motion.span>
              )}

              <div className="flex items-center gap-1.5 pb-1" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: slot.color, boxShadow: '0 0 0 1.5px rgba(255,255,255,.7), var(--shadow-1)' }} />
                <span className="font-extrabold text-[11px] truncate flex-1" style={{ color: 'var(--text)' }}>
                  {slot.username}{isMe && ' (Bạn)'}
                </span>
                {slot.disconnected && <Badge tone="danger" style={{ fontSize: 8, padding: '1px 5px' }}>DC</Badge>}
              </div>

              <div className="grid grid-cols-3 gap-1 text-[10px] font-bold" style={{ color: 'var(--text-2)' }}>
                <span className="flex items-center gap-0.5" title="Điểm thắng">🏆 <b style={{ color: 'var(--accent-ink)', fontSize: 12 }}>{slot.victoryPoints}</b></span>
                <span className="flex items-center gap-0.5" title="Bài trên tay">🎴 <b style={{ color: 'var(--r-wood)' }}>{totalRes}</b></span>
                <span className="flex items-center gap-0.5" title="Thẻ phát triển">📜 <b style={{ color: 'var(--info)' }}>{slot.devCardsCount || 0}</b></span>
              </div>

              <div className="flex items-center justify-between text-[9px] font-semibold pt-1" style={{ color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                <span title="Làng còn lại">🏠 {settlementsLeft}</span>
                <span title="Thành còn lại">🏙️ {citiesLeft}</span>
                <span title="Đường còn lại">🛣️ {roadsLeft}</span>
              </div>

              {(hasLongestRoad || hasLargestArmy || slot.knightsPlayed > 0 || slot.longestRoadLength > 0) && (
                <div className="flex items-center gap-1.5 pt-1 text-[9px] font-bold" style={{ borderTop: '1px solid var(--border)' }}>
                  {(hasLargestArmy || slot.knightsPlayed > 0) && (
                    <span className="flex items-center gap-0.5 px-1.5 rounded" title={hasLargestArmy ? 'Đạo quân lớn nhất (+2 VP)' : 'Knight đã chơi'}
                      style={hasLargestArmy ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' } : { color: 'var(--muted)' }}>
                      ⚔️ {slot.knightsPlayed || 0}{hasLargestArmy && ' 👑'}
                    </span>
                  )}
                  {(hasLongestRoad || slot.longestRoadLength > 0) && (
                    <span className="flex items-center gap-0.5 px-1.5 rounded" title={hasLongestRoad ? 'Đường dài nhất (+2 VP)' : 'Chuỗi đường dài nhất'}
                      style={hasLongestRoad ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' } : { color: 'var(--muted)' }}>
                      🛣️ {slot.longestRoadLength || 0}{hasLongestRoad && ' 👑'}
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Barbarian threat (Cities & Knights) */}
      {gameState.gameMode === 'cities' && (
        <div className="shrink-0 min-w-[116px] p-1.5 px-2.5 rounded-xl flex flex-col gap-1"
             style={{ background: '#fdecec', border: '1px solid #f4c9c9' }}>
          <div className="flex justify-between items-center text-[10px] font-black uppercase" style={{ color: 'var(--danger)' }}>
            <span>Barbarian</span><span>☠️ {gameState.barbarianStep}/7</span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#f4c9c9' }}>
            <motion.div className="h-full rounded-full" style={{ background: 'var(--danger)' }}
              animate={{ width: `${(gameState.barbarianStep / 7) * 100}%` }} transition={{ duration: 0.4 }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default Scoreboard;
