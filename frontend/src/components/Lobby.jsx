import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { Button, Panel, Card, Badge } from '../ui';
import MapPreview from './MapPreview';

const SLOT_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#eab308', '#06b6d4', '#ec4899'];

const MODES = [
  { key: 'basic',     title: 'Classic',            icon: '🎲', desc: '19 hex chuẩn, đặt quân kiểu snake draft.' },
  { key: 'seafarers', title: 'Seafarers',          icon: '⛵', desc: '37 hex, đảo ven biển, tuyến hàng hải.' },
  { key: 'cities',    title: 'Cities & Knights',   icon: '🏛️', desc: 'Commodity, nâng cấp thành, metropolis. 13 VP.' },
];

const inputStyle = {
  background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)', color: 'var(--text)',
};

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function Lobby() {
  const gameState = useGameStore((state) => state.gameState);
  const createRoom = useGameStore((state) => state.createRoom);
  const joinRoom = useGameStore((state) => state.joinRoom);
  const startGame = useGameStore((state) => state.startGame);
  const socket = useGameStore((state) => state.socket);
  const toggleReady = useGameStore((state) => state.toggleReady);
  const cycleColor = useGameStore((state) => state.cycleColor);
  const switchSlot = useGameStore((state) => state.switchSlot);
  const exitGame = useGameStore((state) => state.exitGame);

  const [activeTab, setActiveTab] = useState('join');
  const [username, setUsername] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [copied, setCopied] = useState(false);

  const [gameMode, setGameMode] = useState('basic');
  const [hideBankCards, setHideBankCards] = useState(false);
  const [balancedDice, setBalancedDice] = useState(false);
  const [victoryPointsLimit, setVictoryPointsLimit] = useState(10);
  const [turnTimeoutLimit, setTurnTimeoutLimit] = useState(60);
  const [allMaps, setAllMaps] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState('standard');
  const [slots, setSlots] = useState([
    { type: 'human', color: SLOT_COLORS[0] }, { type: 'human', color: SLOT_COLORS[1] },
    { type: 'human', color: SLOT_COLORS[2] }, { type: 'human', color: SLOT_COLORS[3] },
    { type: 'empty', color: SLOT_COLORS[4] }, { type: 'empty', color: SLOT_COLORS[5] },
    { type: 'empty', color: SLOT_COLORS[6] }, { type: 'empty', color: SLOT_COLORS[7] },
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) { setRoomCodeInput(roomParam.toUpperCase()); setActiveTab('join'); }
  }, []);

  // Load the map catalog once.
  useEffect(() => {
    fetch('/api/maps')
      .then((r) => r.json())
      .then((d) => setAllMaps(d.maps || []))
      .catch(() => setAllMaps([]));
  }, []);

  const mapsForMode = allMaps.filter((m) => m.modes.includes(gameMode));
  const selectedMap = mapsForMode.find((m) => m.id === selectedMapId) || mapsForMode[0];

  // When the mode changes (or catalog loads), snap to that mode's first map
  // and adopt its suggested victory-point target.
  useEffect(() => {
    if (!mapsForMode.length) return;
    if (!mapsForMode.some((m) => m.id === selectedMapId)) {
      const first = mapsForMode[0];
      setSelectedMapId(first.id);
      if (gameMode !== 'cities') setVictoryPointsLimit(first.defaultVP);
    }
  }, [gameMode, allMaps]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectMap = (m) => {
    setSelectedMapId(m.id);
    if (gameMode !== 'cities') setVictoryPointsLimit(m.defaultVP);
  };

  const handleCycleColor = (index) => {
    setSlots((prev) => {
      const next = [...prev];
      const cur = SLOT_COLORS.indexOf(next[index].color);
      next[index] = { ...next[index], color: SLOT_COLORS[(cur + 1) % SLOT_COLORS.length] };
      return next;
    });
  };
  const handleChangeSlotType = (index, type) => {
    setSlots((prev) => { const next = [...prev]; next[index] = { ...next[index], type }; return next; });
  };
  const handleCreateRoom = () => {
    if (!username.trim()) return alert('Vui lòng nhập tên.');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    createRoom(code, username, gameMode, hideBankCards, balancedDice, victoryPointsLimit, turnTimeoutLimit, slots, selectedMap ? selectedMap.id : undefined);
  };
  const handleJoinRoom = () => {
    if (!username.trim() || !roomCodeInput.trim()) return alert('Nhập tên và mã phòng.');
    joinRoom(roomCodeInput.toUpperCase(), username);
  };
  const handleCopyLink = () => {
    if (!gameState) return;
    const inviteUrl = `${window.location.origin}/?room=${gameState.code}`;
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  // ---------------- In-lobby waiting room ----------------
  if (gameState && gameState.gameState === 'lobby') {
    const isHost = gameState.slots[0] && gameState.slots[0].id === socket.id;
    const mySlot = gameState.slots.find((s) => s.id === socket.id);
    const isReady = mySlot ? mySlot.ready : false;
    const humans = gameState.slots.filter((s) => s.type === 'human' && s.username !== null);
    const allReady = humans.every((s) => s.ready);
    const notReadyPlayers = humans.filter((s) => !s.ready).map((s) => s.username);

    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-full max-w-[560px] p-4 my-8">
        <Panel className="p-7 text-center">
          <h2 className="text-3xl font-extrabold mb-1 tracking-tight">Phòng chờ · {gameState.code}</h2>
          <div className="flex justify-center mb-5 mt-2">
            <Button variant="soft" tone={copied ? 'success' : 'neutral'} size="sm" onClick={handleCopyLink}>
              {copied ? 'Đã copy! 📋' : 'Copy link mời 🔗'}
            </Button>
          </div>

          <Card className="p-4 mb-6 text-left">
            <h4 className="text-[10px] font-black uppercase tracking-widest mb-2 pb-2" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>Ghế trong phòng</h4>
            <div className="flex flex-col gap-2">
              {gameState.slots.map((s, idx) => {
                const isMe = s.id === socket.id;
                const isEmpty = s.type === 'empty' || (s.type === 'human' && s.username === null);
                return (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-xl"
                    style={{ background: 'var(--surface)', border: isMe ? '1px solid var(--accent)' : '1px solid var(--border)', boxShadow: isMe ? 'var(--ring)' : 'none' }}>
                    <div className="flex items-center gap-3">
                      <button disabled={!isMe} onClick={() => cycleColor(idx)}
                        className="w-5 h-5 rounded-full shrink-0 transition-transform"
                        style={{ background: s.color, boxShadow: '0 0 0 1.5px #fff, var(--shadow-1)', cursor: isMe ? 'pointer' : 'default' }}
                        title={isMe ? 'Bấm để đổi màu' : ''} />
                      {isEmpty
                        ? <span className="text-xs italic font-bold" style={{ color: 'var(--muted)' }}>{s.type === 'empty' ? 'Ghế trống' : 'Ghế người chưa nhận'}</span>
                        : <span className="font-extrabold text-xs">{s.username}{isMe && <span className="ml-1 text-[10px]" style={{ color: 'var(--accent-ink)' }}>(Bạn)</span>}</span>}
                    </div>
                    <div>
                      {isEmpty
                        ? <Button variant="soft" tone="info" size="sm" onClick={() => switchSlot(idx)}>Nhận ghế 🚪</Button>
                        : s.type === 'human'
                          ? <Badge tone={s.ready ? 'success' : 'neutral'}>{s.ready ? 'Sẵn sàng ✔️' : 'Chưa ⏳'}</Badge>
                          : <Badge tone="info">🤖 Bot</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {mySlot && (
            <Button variant="solid" tone={isReady ? 'danger' : 'success'} size="lg" onClick={toggleReady}
              className="w-full mb-3">{isReady ? 'Hủy sẵn sàng 👎' : 'Tôi đã sẵn sàng! 👍'}</Button>
          )}

          {isHost ? (
            <div className="w-full flex flex-col gap-2">
              <Button variant="solid" tone="info" size="lg" disabled={!allReady} onClick={startGame} className="w-full">
                Bắt đầu ván Catan 🚀
              </Button>
              {!allReady && <span className="text-[11px] font-bold" style={{ color: 'var(--danger)' }}>Đang chờ: {notReadyPlayers.join(', ')}</span>}
            </div>
          ) : (
            <div className="text-xs font-bold py-2.5 w-full rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
              {allReady ? 'Chờ chủ phòng bắt đầu…' : 'Chờ mọi người sẵn sàng…'}
            </div>
          )}

          <Button variant="ghost" tone="neutral" size="sm" onClick={exitGame} className="w-full mt-5">Rời phòng 🚪</Button>
        </Panel>
      </motion.div>
    );
  }

  // ---------------- Landing (join / host) ----------------
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 max-w-[900px] w-full p-4 my-8">
      {/* Header: name + tabs */}
      <Panel className="flex flex-col md:flex-row justify-between items-center p-5 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <span className="text-2xl">🎲</span>
          <div className="flex flex-col">
            <span className="font-black text-lg leading-none">CATAN</span>
            <span className="text-[10px] font-bold" style={{ color: 'var(--muted)' }}>bản đầy đủ luật gốc</span>
          </div>
          <input type="text" placeholder="Tên của bạn" value={username} onChange={(e) => setUsername(e.target.value)}
            className="focusable px-4 py-2 font-bold w-full md:w-52 ml-2" style={inputStyle} />
        </div>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {['join', 'host'].map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-6 py-2 rounded-lg font-bold text-sm transition-all relative"
              style={{ color: activeTab === t ? '#fff' : 'var(--text-2)' }}>
              {activeTab === t && <motion.span layoutId="tabPill" className="absolute inset-0 rounded-lg" style={{ background: 'var(--accent)', zIndex: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span className="relative z-10">{t === 'join' ? 'Vào phòng' : 'Tạo phòng'}</span>
            </button>
          ))}
        </div>
      </Panel>

      <AnimatePresence mode="wait">
        {activeTab === 'join' ? (
          <motion.div key="join" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }} className="mx-auto w-full max-w-[440px]">
            <Panel className="p-9 text-center flex flex-col gap-6">
              <div>
                <h3 className="text-2xl font-extrabold mb-1">Vào phòng Catan</h3>
                <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Nhập mã bạn bè gửi để tham gia.</p>
              </div>
              <input type="text" placeholder="Mã phòng (vd ABCD)" value={roomCodeInput} onChange={(e) => setRoomCodeInput(e.target.value)}
                className="focusable px-4 py-3 text-center font-black tracking-[0.3em] text-lg uppercase" style={inputStyle} />
              <Button variant="solid" tone="info" size="lg" onClick={handleJoinRoom}>Tham gia</Button>
            </Panel>
          </motion.div>
        ) : (
          <motion.div key="host" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
            <Panel className="p-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Config */}
                <div className="flex flex-col gap-5">
                  <div>
                    <h3 className="text-xl font-black mb-1">Cấu hình ván đấu</h3>
                    <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Chọn biến thể và luật nhà.</p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    {MODES.map((m) => {
                      const active = gameMode === m.key;
                      return (
                        <motion.div key={m.key} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => setGameMode(m.key)}
                          className="flex-1 p-4 cursor-pointer"
                          style={{ borderRadius: 'var(--radius)', border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: active ? 'var(--accent-soft)' : 'var(--surface-2)', boxShadow: active ? 'var(--shadow-2)' : 'none' }}>
                          <div className="text-xl mb-1">{m.icon}</div>
                          <h4 className="font-extrabold text-sm mb-1" style={{ color: active ? 'var(--accent-ink)' : 'var(--text)' }}>{m.title}</h4>
                          <p className="text-[10px] font-semibold leading-relaxed" style={{ color: 'var(--muted)' }}>{m.desc}</p>
                        </motion.div>
                      );
                    })}
                  </div>

                  <Field label={`Bản đồ${selectedMap ? ` · ${selectedMap.name}` : ''}`}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {mapsForMode.map((m) => {
                        const active = selectedMap && selectedMap.id === m.id;
                        return (
                          <motion.div key={m.id} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => handleSelectMap(m)}
                            title={m.desc}
                            className="p-2 cursor-pointer flex flex-col gap-1.5"
                            style={{ borderRadius: 'var(--radius)', border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                              background: active ? 'var(--accent-soft)' : 'var(--surface-2)', boxShadow: active ? 'var(--shadow-2)' : 'none' }}>
                            <div className="rounded-md overflow-hidden flex items-center justify-center"
                              style={{ background: 'var(--surface)', border: '1px solid var(--border)', aspectRatio: '4 / 3' }}>
                              <MapPreview hexes={m.hexes} style={{ width: '100%', height: '100%' }} />
                            </div>
                            <span className="font-extrabold text-[10px] leading-tight truncate" style={{ color: active ? 'var(--accent-ink)' : 'var(--text)' }}>{m.name}</span>
                          </motion.div>
                        );
                      })}
                      {!mapsForMode.length && (
                        <span className="text-[11px] font-semibold col-span-full" style={{ color: 'var(--muted)' }}>Đang tải bản đồ…</span>
                      )}
                    </div>
                    {selectedMap && (
                      <p className="text-[10px] font-semibold mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{selectedMap.desc}</p>
                    )}
                  </Field>

                  <Field label="Điểm thắng">
                    <div className="flex items-center gap-3">
                      <input type="range" min="3" max="15" value={victoryPointsLimit} onChange={(e) => setVictoryPointsLimit(Number(e.target.value))}
                        className="w-full cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
                      <Badge tone="accent" style={{ minWidth: 52, justifyContent: 'center' }}>{victoryPointsLimit} VP</Badge>
                    </div>
                  </Field>

                  <Field label="Hết giờ mỗi lượt">
                    <select value={turnTimeoutLimit} onChange={(e) => setTurnTimeoutLimit(Number(e.target.value))}
                      className="focusable px-4 py-2 font-bold" style={inputStyle}>
                      <option value="0">Không giới hạn</option>
                      <option value="30">30 giây</option>
                      <option value="60">60 giây</option>
                      <option value="90">90 giây</option>
                      <option value="120">120 giây</option>
                    </select>
                  </Field>

                  <div className="flex flex-col gap-2">
                    {[['Xúc xắc cân bằng (bộ 36)', balancedDice, setBalancedDice], ['Ẩn bài của Bank', hideBankCards, setHideBankCards]].map(([lbl, val, set]) => (
                      <label key={lbl} className="flex items-center gap-3 cursor-pointer text-sm font-bold select-none">
                        <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)}
                          className="w-5 h-5 cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
                        {lbl}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Slots */}
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-xl font-black mb-1">Người chơi</h3>
                    <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Thiết lập người & bot cho ván này.</p>
                  </div>
                  <Card className="p-4">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                          <th className="pb-2">Ghế</th><th className="pb-2">Loại</th><th className="pb-2 text-center">Màu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slots.map((s, idx) => (
                          <tr key={idx} className="text-sm font-bold" style={{ borderTop: '1px solid var(--border)' }}>
                            <td className="py-2">{idx === 0 ? 'Ghế 1 (Chủ)' : `Ghế ${idx + 1}`}</td>
                            <td className="py-2">
                              {idx === 0
                                ? <span className="font-extrabold" style={{ color: 'var(--info)' }}>Người (Bạn)</span>
                                : <select value={s.type} onChange={(e) => handleChangeSlotType(idx, e.target.value)}
                                    className="focusable px-2 py-0.5 text-xs font-bold" style={inputStyle}>
                                    <option value="empty">Không</option>
                                    <option value="human">Người</option>
                                    <option value="bot_easy">Bot (Dễ)</option>
                                    <option value="bot_medium">Bot (Vừa)</option>
                                    <option value="bot_hard">Bot (Khó)</option>
                                    <option value="bot_mcts">🧠 AI (MCTS) — Classic</option>
                                  </select>}
                            </td>
                            <td className="py-2 text-center">
                              <button onClick={() => handleCycleColor(idx)} className="w-6 h-6 rounded-full transition-transform active:scale-90"
                                style={{ background: s.color, boxShadow: '0 0 0 1.5px #fff, var(--shadow-1)' }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </div>
              </div>

              <Button variant="solid" tone="accent" size="lg" onClick={handleCreateRoom} className="w-full">
                Tạo phòng & mở lobby 🔑
              </Button>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default Lobby;
