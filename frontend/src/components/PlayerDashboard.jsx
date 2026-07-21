import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

const RESOURCE_INFO = {
  wood: { name: 'Wood', emoji: '🌲', style: 'bg-emerald-600 border-emerald-950 text-white' },
  brick: { name: 'Brick', emoji: '🧱', style: 'bg-orange-500 border-orange-950 text-white' },
  sheep: { name: 'Sheep', emoji: '🐑', style: 'bg-teal-400 border-teal-950 text-white' },
  wheat: { name: 'Wheat', emoji: '🌾', style: 'bg-amber-400 border-amber-950 text-white' },
  ore: { name: 'Ore', emoji: '⛰️', style: 'bg-slate-400 border-slate-950 text-white' }
};

function PlayerDashboard() {
  const gameState = useGameStore((state) => state.gameState);
  const socket = useGameStore((state) => state.socket);
  const rollDice = useGameStore((state) => state.rollDice);
  const endTurn = useGameStore((state) => state.endTurn);
  const buyDevCard = useGameStore((state) => state.buyDevCard);
  const bankTrade = useGameStore((state) => state.bankTrade);
  const submitDiscard = useGameStore((state) => state.submitDiscard);
  const playDevCard = useGameStore((state) => state.playDevCard);
  
  const proposeTrade = useGameStore((state) => state.proposeTrade);
  const acceptTrade = useGameStore((state) => state.acceptTrade);
  const counterTrade = useGameStore((state) => state.counterTrade);
  const cancelTrade = useGameStore((state) => state.cancelTrade);
  const executeTrade = useGameStore((state) => state.executeTrade);

  // Modal toggle state for Trade Builder
  const [isTradeOpen, setIsTradeOpen] = useState(false);
  const [tradeTab, setTradeTab] = useState('player'); // 'player' | 'bank'

  // Bank Trade selection
  const [tradeOffer, setTradeOffer] = useState('wood');
  const [tradeDemand, setTradeDemand] = useState('brick');

  // Drag-to-play local states
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [draggedCardType, setDraggedCardType] = useState(null);

  // Player-to-Player trade proposal state
  const [domesticOffer, setDomesticOffer] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const [domesticDemand, setDomesticDemand] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const [counterOffer, setCounterOffer] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const [counterDemand, setCounterDemand] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const [showCounterForm, setShowCounterForm] = useState(false);

  // Local state to decline/hide an active trade offer
  const [ignoredTradeId, setIgnoredTradeId] = useState(null);

  // Discard Phase local selection
  const [discardSel, setDiscardSel] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });

  // Dev Card Playing Modals State
  const [activeModal, setActiveModal] = useState(null); // 'Knight' | 'Road Building' | 'Year of Plenty' | 'Monopoly' | null
  const [yopSelection, setYopSelection] = useState([]); // Array of up to 2 resource keys
  const [monopolyResource, setMonopolyResource] = useState('wood'); // Resource key

  // Dice shake animation state
  const [isShaking, setIsShaking] = useState(false);
  const [shakingDice, setShakingDice] = useState([1, 1]);
  const prevRollRef = useRef(null);

  useEffect(() => {
    if (!gameState) return;
    const lr = gameState.diceRolled && gameState.lastDiceRoll ? gameState.lastDiceRoll.join(',') : null;
    // Shake whenever a *new* roll result arrives, then settle on the real value.
    if (lr && lr !== prevRollRef.current) {
      prevRollRef.current = lr;
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 550);
      return () => clearTimeout(timer);
    }
    if (!gameState.diceRolled) prevRollRef.current = null;
  }, [gameState?.diceRolled, gameState?.lastDiceRoll]);

  // Dice roll simulation pips cycling
  useEffect(() => {
    if (isShaking) {
      const interval = setInterval(() => {
        setShakingDice([
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1
        ]);
      }, 60);
      return () => clearInterval(interval);
    }
  }, [isShaking]);

  // Auto-open modal on active trade if proposer
  useEffect(() => {
    if (gameState?.activeTrade && me && gameState.activeTrade.proposer === me.index) {
      setIsTradeOpen(true);
      setTradeTab('player');
    }
  }, [gameState?.activeTrade]);

  if (!gameState) return null;

  const me = gameState.slots.find((s) => s.id === socket.id);
  const activePlayer = gameState.slots[gameState.currentPlayerIndex];
  const isMyTurn = activePlayer && activePlayer.id === socket.id;

  const settlementsCount = me ? gameState.board.vertices.filter(v => v.owner === me.index && v.building === 'settlement').length : 0;
  const citiesCount = me ? gameState.board.vertices.filter(v => v.owner === me.index && v.building === 'city').length : 0;
  const roadsCount = me ? gameState.board.edges.filter(e => e.owner === me.index).length : 0;

  const hasEnoughForDev = me && me.resources.ore >= 1 && me.resources.wheat >= 1 && me.resources.sheep >= 1;

  // Discard Phase checks
  const needsDiscard =
    gameState.gameState === 'discard' &&
    me &&
    gameState.discardsPending &&
    gameState.discardsPending[me.index] !== undefined;

  const discardTarget = needsDiscard ? gameState.discardsPending[me.index] : 0;
  const discardSelectedTotal = Object.values(discardSel).reduce((a, b) => a + b, 0);

  const handleAdjustDiscard = (res, amount) => {
    if (!me) return;
    const owns = me.resources[res] || 0;
    setDiscardSel((prev) => {
      const nextVal = prev[res] + amount;
      if (nextVal < 0 || nextVal > owns) return prev;
      const curTotal = Object.values(prev).reduce((a, b) => a + b, 0) - prev[res] + nextVal;
      if (curTotal > discardTarget) return prev;
      return { ...prev, [res]: nextVal };
    });
  };

  const handleSubmitDiscard = () => {
    submitDiscard(discardSel);
    setDiscardSel({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  };

  // Trade Ratios computation
  const getPlayerTradeRatios = () => {
    const ratios = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    if (!gameState || !me) return ratios;
    
    const ports = gameState.board.ports || [];
    ports.forEach((port) => {
      let hasAccess = false;
      const vertices = port.vertices || [];
      for (let v_id of vertices) {
        const v = gameState.board.vertices[v_id];
        if (v && v.owner === me.index && (v.building === 'settlement' || v.building === 'city')) {
          hasAccess = true;
          break;
        }
      }
      if (hasAccess) {
        const ptype = port.type;
        if (ptype === 'generic') {
          for (let res in ratios) {
            ratios[res] = Math.min(ratios[res], 3);
          }
        } else if (ptype in ratios) {
          ratios[ptype] = Math.min(ratios[ptype], 2);
        }
      }
    });
    return ratios;
  };

  const myRatios = getPlayerTradeRatios();
  const hasEnoughForBankTrade = me && me.resources[tradeOffer] >= myRatios[tradeOffer];

  const adjustDomesticOffer = (res, val) => {
    setDomesticOffer(prev => {
      const newVal = prev[res] + val;
      if (newVal < 0) return prev;
      if (me && newVal > (me.resources[res] || 0)) return prev;
      return { ...prev, [res]: newVal };
    });
  };

  const adjustDomesticDemand = (res, val) => {
    setDomesticDemand(prev => {
      const newVal = prev[res] + val;
      if (newVal < 0) return prev;
      return { ...prev, [res]: newVal };
    });
  };

  const adjustCounterOffer = (res, val) => {
    setCounterOffer(prev => {
      const newVal = prev[res] + val;
      if (newVal < 0) return prev;
      if (me && newVal > (me.resources[res] || 0)) return prev;
      return { ...prev, [res]: newVal };
    });
  };

  const adjustCounterDemand = (res, val) => {
    setCounterDemand(prev => {
      const newVal = prev[res] + val;
      if (newVal < 0) return prev;
      return { ...prev, [res]: newVal };
    });
  };

  const handleProposeTrade = () => {
    const hasOffer = Object.values(domesticOffer).some(q => q > 0);
    const hasDemand = Object.values(domesticDemand).some(q => q > 0);
    if (!hasOffer || !hasDemand) return;
    proposeTrade(domesticOffer, domesticDemand);
    setDomesticOffer({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    setDomesticDemand({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  };

  const handleBankTrade = () => {
    bankTrade(tradeOffer, tradeDemand);
  };

  // Drag & Drop Handlers for Dev Cards
  const handleDragStart = (e, type) => {
    setIsDraggingCard(true);
    setDraggedCardType(type);
    e.dataTransfer.setData('text/plain', type);
  };

  const handleDragEnd = () => {
    setIsDraggingCard(false);
    setDraggedCardType(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain') || draggedCardType;
    setIsDraggingCard(false);
    setDraggedCardType(null);
    if (type) {
      if (type === 'Knight') {
        playDevCard('Knight');
      } else if (type === 'Road Building') {
        playDevCard('Road Building');
      } else {
        setActiveModal(type);
      }
    }
  };

  // Pip-based dice rendering
  const renderDiePips = (value) => {
    const pipsMap = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8]
    };
    const activePips = pipsMap[value] || [];
    return (
      <div className="grid grid-cols-3 gap-1 w-8 h-8 p-1">
        {[...Array(9)].map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-all ${
              activePips.includes(i) ? 'bg-slate-900' : 'bg-transparent'
            }`}
          />
        ))}
      </div>
    );
  };

  // Group development cards
  const groupCards = (list) => {
    const counts = {};
    list.forEach((c) => {
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  };

  const playableGroups = me ? groupCards(me.devCards) : {};
  const lockedGroups = me ? groupCards(me.devCardsBoughtThisTurn || []) : {};
  const cardTypes = ['Knight', 'Victory Point', 'Road Building', 'Year of Plenty', 'Monopoly'];

  const getDevCardIcon = (card) => {
    if (card === 'Knight') return '⚔️';
    if (card === 'Victory Point') return '🏆';
    if (card === 'Road Building') return '🛣️';
    if (card === 'Year of Plenty') return '🌾';
    if (card === 'Monopoly') return '💰';
    return '📜';
  };

  // Render a visual stack of card elements
  const renderCardStack = (cardType, count, isPlayable, isLocked) => {
    if (count <= 0) return null;
    const icon = getDevCardIcon(cardType);
    const isVP = cardType === 'Victory Point';
    const canPlayThisTurn = isMyTurn && gameState.gameState === 'playing' && !me.devCardPlayedThisTurn && !isVP && isPlayable;

    return (
      <div key={`${cardType}-${isLocked ? 'locked' : 'playable'}`} className="relative w-20 h-28 shrink-0">
        {[...Array(count)].map((_, cIdx) => (
          <div
            key={cIdx}
            draggable={canPlayThisTurn && cIdx === count - 1}
            onDragStart={(e) => handleDragStart(e, cardType)}
            onDragEnd={handleDragEnd}
            onClick={() => {
              if (canPlayThisTurn && cIdx === count - 1) {
                if (cardType === 'Knight' || cardType === 'Road Building') {
                  playDevCard(cardType);
                } else {
                  setActiveModal(cardType);
                }
              }
            }}
            className={`absolute inset-0 border-2 rounded-xl p-2.5 flex flex-col justify-between shadow-lg transition-all select-none ${
              isLocked
                ? 'bg-slate-800/80 border-slate-600 text-slate-400 border-dashed opacity-75 cursor-not-allowed'
                : canPlayThisTurn
                ? 'bg-amber-100 hover:bg-amber-200 border-slate-950 text-slate-950 cursor-grab hover:ring-2 hover:ring-indigo-500 hover:-translate-y-2'
                : isVP
                ? 'bg-amber-50 border-amber-500 text-slate-900 shadow-amber-900/30 cursor-default'
                : 'bg-slate-200 border-slate-400 text-slate-500 cursor-not-allowed'
            }`}
            style={{
              transform: `translate(${cIdx * 5}px, ${-cIdx * 5}px)`,
              zIndex: cIdx + (isLocked ? 10 : 20),
            }}
            title={
              isLocked
                ? 'Bought this turn (locked).'
                : isVP
                ? 'Victory Point cards are kept hidden and counted automatically.'
                : canPlayThisTurn
                ? `Drag to center or click to play ${cardType}`
                : 'Cannot play card right now.'
            }
          >
            {/* Top row */}
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[7px] font-black uppercase tracking-wider text-slate-500">
                {isLocked ? 'Locked' : cardType}
              </span>
              {isLocked && <span className="text-[9px]">🔒</span>}
            </div>

            {/* Center icon */}
            <div className="text-3xl text-center shrink-0">{icon}</div>

            {/* Bottom info */}
            <div className="text-[8px] font-bold text-center shrink-0">
              {isVP ? '+1 VP' : isLocked ? 'Wait' : canPlayThisTurn ? 'Play / Drag' : 'Idle'}
            </div>

            {/* Stack count badge */}
            {count > 1 && cIdx === count - 1 && (
              <div className="absolute -top-2 -right-2 bg-slate-950 border border-slate-700 text-white font-extrabold text-[8px] w-4.5 h-4.5 rounded-full flex items-center justify-center shadow-md">
                x{count}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full relative min-h-[160px] pb-6 px-8 flex items-end justify-between gap-6 pointer-events-none">
      
      {/* ---------------- 1. DRAG ZONE OVERLAY ---------------- */}
      {isDraggingCard && (
        <div 
          className="fixed inset-0 bg-[color:var(--surface-2)] backdrop-blur-sm z-30 flex items-center justify-center pointer-events-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => setIsDraggingCard(false)}
        >
          <div className="w-[360px] h-[220px] border-4 border-dashed border-indigo-400 bg-[color:var(--surface)] rounded-3xl flex flex-col items-center justify-center gap-4 shadow-2xl text-[color:var(--text)] select-none animate-bounce">
            <span className="text-5xl">🎴</span>
            <div className="flex flex-col gap-1 items-center">
              <span className="font-black text-lg">Drop Card Here</span>
              <span className="text-xs text-indigo-300 font-bold uppercase tracking-wider">
                To Play {draggedCardType}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 2. NON-INTRUSIVE DISCARD PANEL (RIGHT SIDE DRAWER) ---------------- */}
      {needsDiscard && (
        <div className="fixed top-20 right-4 w-96 max-h-[calc(100vh-120px)] bg-[color:var(--surface)] backdrop-blur-md border border-[color:var(--border)] rounded-2xl shadow-2xl p-5 overflow-y-auto z-40 flex flex-col gap-4 text-[color:var(--text)] border-[color:var(--border)] pointer-events-auto">
          <h2 className="text-xl font-black flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
            <span>☠️</span> The Robber Strikes!
          </h2>
          <p className="text-xs font-bold text-[color:var(--text-2)]">
            A 7 was rolled! You must select and discard <span className="text-red-400 font-black">{discardTarget}</span> cards from your hand.
          </p>

          <div className="flex flex-col gap-2 my-2">
            {Object.entries(RESOURCE_INFO).map(([key, info]) => {
              const owns = me ? me.resources[key] || 0 : 0;
              const sel = discardSel[key] || 0;
              return (
                <div key={key} className="flex items-center justify-between bg-[color:var(--surface-2)]/60 border border-[color:var(--border)] rounded-xl p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{info.emoji}</span>
                    <span className="font-extrabold text-xs">{info.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[color:var(--muted)] font-semibold mr-1">({owns} owned)</span>
                    <button
                      onClick={() => handleAdjustDiscard(key, -1)}
                      className="w-7 h-7 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-2)] text-[color:var(--text)] font-bold text-xs hover:bg-[color:var(--border)] flex items-center justify-center cursor-pointer shadow active:translate-y-0.5"
                    >
                      -
                    </button>
                    <span className="font-black text-xs w-4 text-center">{sel}</span>
                    <button
                      onClick={() => handleAdjustDiscard(key, 1)}
                      className="w-7 h-7 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-2)] text-[color:var(--text)] font-bold text-xs hover:bg-[color:var(--border)] flex items-center justify-center cursor-pointer shadow active:translate-y-0.5"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center text-xs font-black pt-2 border-t border-[color:var(--border)]">
            <span>Selected:</span>
            <span className={discardSelectedTotal === discardTarget ? 'text-emerald-400' : 'text-amber-400'}>
              {discardSelectedTotal} / {discardTarget}
            </span>
          </div>

          <button
            onClick={handleSubmitDiscard}
            disabled={discardSelectedTotal !== discardTarget}
            className="w-full py-3 bg-red-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-xl shadow-[var(--shadow-1)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-500 active:translate-y-[2px] active:shadow-none transition-all uppercase text-xs cursor-pointer mt-2"
          >
            Confirm Discard
          </button>
        </div>
      )}

      {/* ---------------- 3. FLOATING RESPONDER TRADE OFFER BUBBLE ---------------- */}
      {gameState.activeTrade && me && gameState.activeTrade.proposer !== me.index && ignoredTradeId !== gameState.activeTrade.timestamp && (
        <div className="fixed bottom-28 left-4 z-40 max-w-sm bg-[color:var(--surface)] backdrop-blur-md border border-[color:var(--border)] rounded-2xl p-4 shadow-2xl flex flex-col gap-3 text-[color:var(--text)] border-[color:var(--border)] pointer-events-auto animate-in fade-in slide-in-from-bottom duration-300">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] pb-1.5">
            <span className="text-[10px] font-black text-indigo-300 uppercase tracking-wider">
              Trade Proposal
            </span>
            <span className="text-[10px] font-bold text-[color:var(--muted)]">
              From: {gameState.slots[gameState.activeTrade.proposer].username}
            </span>
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap gap-1 items-center">
              <span className="font-semibold text-[color:var(--muted)] text-[10px] uppercase w-12">Offers:</span>
              {Object.entries(gameState.activeTrade.offer).map(([res, qty]) => (
                <span key={res} className="bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold text-emerald-300 text-[10px]">
                  {qty} {RESOURCE_INFO[res].emoji}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              <span className="font-semibold text-[color:var(--muted)] text-[10px] uppercase w-12">Demands:</span>
              {Object.entries(gameState.activeTrade.demand).map(([res, qty]) => (
                <span key={res} className="bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 rounded font-bold text-blue-300 text-[10px]">
                  {qty} {RESOURCE_INFO[res].emoji}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={acceptTrade}
              disabled={!Object.entries(gameState.activeTrade.demand).every(([res, qty]) => me.resources[res] >= qty)}
              className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg text-[10px] uppercase cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-[var(--shadow-1)] active:translate-y-0.5"
            >
              Accept ✔️
            </button>
            <button
              onClick={() => {
                const initialOffer = {};
                const initialDemand = {};
                Object.keys(RESOURCE_INFO).forEach(k => {
                  initialOffer[k] = gameState.activeTrade.demand[k] || 0;
                  initialDemand[k] = gameState.activeTrade.offer[k] || 0;
                });
                setCounterOffer(initialOffer);
                setCounterDemand(initialDemand);
                setShowCounterForm(true);
                setIsTradeOpen(true);
                setTradeTab('player');
              }}
              className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-white font-black rounded-lg text-[10px] uppercase cursor-pointer shadow-[var(--shadow-1)] active:translate-y-0.5"
            >
              Counter 💬
            </button>
            <button
              onClick={() => setIgnoredTradeId(gameState.activeTrade.timestamp)}
              className="py-1.5 px-2.5 bg-[color:var(--surface-2)] hover:bg-[color:var(--border)] text-[color:var(--text-2)] font-black rounded-lg text-[10px] uppercase cursor-pointer"
            >
              Decline ❌
            </button>
          </div>
        </div>
      )}

      {/* ---------------- 4. CENTRALIZED TRADE BUILDER MODAL ---------------- */}
      {isTradeOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-[color:var(--surface)] border border-[color:var(--border)] rounded-3xl p-6 max-w-xl w-full shadow-2xl flex flex-col gap-4 text-[color:var(--text)] border-[color:var(--border)]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[color:var(--border)] pb-3">
              <div className="flex gap-4">
                <button
                  onClick={() => setTradeTab('player')}
                  className={`text-sm font-black uppercase tracking-wider pb-1.5 border-b-3 transition-all ${
                    tradeTab === 'player' ? 'border-indigo-500 text-[color:var(--text)]' : 'border-transparent text-[color:var(--muted)] hover:text-[color:var(--accent-ink)]'
                  }`}
                >
                  Domestic Trade (Players)
                </button>
                <button
                  onClick={() => setTradeTab('bank')}
                  className={`text-sm font-black uppercase tracking-wider pb-1.5 border-b-3 transition-all ${
                    tradeTab === 'bank' ? 'border-indigo-500 text-[color:var(--text)]' : 'border-transparent text-[color:var(--muted)] hover:text-[color:var(--accent-ink)]'
                  }`}
                >
                  Bank Trade
                </button>
              </div>
              <button
                onClick={() => {
                  setIsTradeOpen(false);
                  setShowCounterForm(false);
                }}
                className="text-[color:var(--muted)] hover:text-[color:var(--accent-ink)] font-black cursor-pointer text-sm"
              >
                ❌
              </button>
            </div>

            {/* DOMESTIC TRADE PANEL */}
            {tradeTab === 'player' && (
              <div className="flex flex-col gap-4">
                {!gameState.activeTrade ? (
                  // Offer Creation Builder
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Proposer Gives */}
                      <div className="bg-[color:var(--surface-2)] p-3 rounded-2xl border border-[color:var(--border)] flex flex-col gap-2">
                        <span className="text-[10px] font-black text-emerald-400 uppercase">You Give:</span>
                        <div className="flex flex-col gap-1.5">
                          {Object.entries(RESOURCE_INFO).map(([key, info]) => (
                            <div key={key} className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1.5">
                                <span className="text-base">{info.emoji}</span>
                                <span>{info.name}</span>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => adjustDomesticOffer(key, -1)}
                                  className="w-5 h-5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] flex items-center justify-center font-bold"
                                >
                                  -
                                </button>
                                <span className="font-extrabold w-3 text-center">{domesticOffer[key]}</span>
                                <button
                                  onClick={() => adjustDomesticOffer(key, 1)}
                                  className="w-5 h-5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] flex items-center justify-center font-bold"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Proposer Demands */}
                      <div className="bg-[color:var(--surface-2)] p-3 rounded-2xl border border-[color:var(--border)] flex flex-col gap-2">
                        <span className="text-[10px] font-black text-blue-400 uppercase">You Receive:</span>
                        <div className="flex flex-col gap-1.5">
                          {Object.entries(RESOURCE_INFO).map(([key, info]) => (
                            <div key={key} className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1.5">
                                <span className="text-base">{info.emoji}</span>
                                <span>{info.name}</span>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => adjustDomesticDemand(key, -1)}
                                  className="w-5 h-5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] flex items-center justify-center font-bold"
                                >
                                  -
                                </button>
                                <span className="font-extrabold w-3 text-center">{domesticDemand[key]}</span>
                                <button
                                  onClick={() => adjustDomesticDemand(key, 1)}
                                  className="w-5 h-5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] flex items-center justify-center font-bold"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleProposeTrade}
                      disabled={!Object.values(domesticOffer).some(q => q > 0) || !Object.values(domesticDemand).some(q => q > 0)}
                      className="py-3 bg-indigo-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-xl shadow-[var(--shadow-1)] hover:bg-indigo-500 active:translate-y-[1px] active:shadow-none transition-all uppercase text-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Propose Trade to Pool 🤝
                    </button>
                  </div>
                ) : (
                  // Active Trade Pool & Responses
                  <div className="flex flex-col gap-4">
                    <div className="bg-[color:var(--surface-2)] p-4 rounded-2xl border border-[color:var(--border)] flex flex-col gap-2 text-xs">
                      <span className="text-[10px] font-black text-[color:var(--muted)] uppercase">
                        {gameState.activeTrade.proposer === me.index ? "Active Proposal Stats" : `Offer from ${gameState.slots[gameState.activeTrade.proposer].username}`}
                      </span>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-[color:var(--muted)] w-16">Offer:</span>
                          {Object.entries(gameState.activeTrade.offer).map(([r, q]) => (
                            <span key={r} className="bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded font-black text-emerald-300">
                              {q} {RESOURCE_INFO[r].emoji}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-[color:var(--muted)] w-16">Demand:</span>
                          {Object.entries(gameState.activeTrade.demand).map(([r, q]) => (
                            <span key={r} className="bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 rounded font-black text-blue-300">
                              {q} {RESOURCE_INFO[r].emoji}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {gameState.activeTrade.proposer === me.index ? (
                      // PROPOSER ACTIVE VIEW
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black text-[color:var(--muted)] uppercase">Player Responses:</span>
                        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                          {gameState.slots
                            .filter(slot => slot.type !== 'empty' && slot.index !== me.index)
                            .map(slot => {
                              const resp = gameState.activeTrade.responses[slot.index];
                              const canExecute = resp && (
                                resp.status === 'accepted' || (
                                  resp.status === 'counter' && Object.entries(resp.demand).every(([res, qty]) => me.resources[res] >= qty)
                                )
                              );
                              
                              return (
                                <div key={slot.index} className="flex items-center justify-between text-xs bg-[color:var(--surface-2)] p-2.5 rounded-xl border border-[color:var(--border)]">
                                  <span className="font-bold">
                                    {slot.username} {slot.type.startsWith('bot') ? '🤖' : ''}
                                  </span>
                                  
                                  {resp ? (
                                    <div className="flex items-center gap-2">
                                      {resp.status === 'accepted' ? (
                                        <span className="text-emerald-400 font-extrabold">Accepted</span>
                                      ) : (
                                        <div className="flex flex-col items-end text-[9px] text-[color:var(--muted)]">
                                          <span className="text-orange-400 font-extrabold uppercase">Counter</span>
                                          <span>Gives: {Object.entries(resp.offer).map(([r, q]) => `${q}${RESOURCE_INFO[r].emoji}`).join(' ')}</span>
                                          <span>Wants: {Object.entries(resp.demand).map(([r, q]) => `${q}${RESOURCE_INFO[r].emoji}`).join(' ')}</span>
                                        </div>
                                      )}
                                      
                                      <button
                                        onClick={() => {
                                          executeTrade(slot.index);
                                          setIsTradeOpen(false);
                                        }}
                                        disabled={!canExecute}
                                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg disabled:opacity-50 cursor-pointer shadow active:translate-y-0.5 text-[10px]"
                                      >
                                        Execute
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[color:var(--muted)] italic">Thinking...</span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                        
                        <button
                          onClick={cancelTrade}
                          className="w-full py-2 bg-red-950 hover:bg-red-900 text-red-400 border border-red-900 rounded-xl uppercase text-[10px] font-black cursor-pointer mt-2"
                        >
                          Cancel Trade Proposal ❌
                        </button>
                      </div>
                    ) : (
                      // RESPONDER ACTIVE VIEW (inside modal if they click Counter)
                      <div className="flex flex-col gap-3">
                        {showCounterForm && (
                          <div className="flex flex-col gap-3 p-3 bg-[color:var(--surface-2)] border border-[color:var(--border)] rounded-2xl">
                            <span className="text-[10px] font-black text-indigo-400 uppercase">Customize Counter-Offer</span>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div className="flex flex-col gap-1.5 bg-[color:var(--surface)] p-2 border border-[color:var(--border)] rounded-xl">
                                <span className="text-[9px] font-bold text-emerald-400">You Give:</span>
                                {Object.entries(RESOURCE_INFO).map(([key, info]) => (
                                  <div key={key} className="flex items-center justify-between">
                                    <span>{info.emoji}</span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => adjustCounterOffer(key, -1)}
                                        className="w-4.5 h-4.5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] flex items-center justify-center font-bold text-[10px]"
                                      >
                                        -
                                      </button>
                                      <span className="font-extrabold text-[10px] w-3 text-center">{counterOffer[key] || 0}</span>
                                      <button
                                        onClick={() => adjustCounterOffer(key, 1)}
                                        className="w-4.5 h-4.5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] flex items-center justify-center font-bold text-[10px]"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="flex flex-col gap-1.5 bg-[color:var(--surface)] p-2 border border-[color:var(--border)] rounded-xl">
                                <span className="text-[9px] font-bold text-blue-400">You Receive:</span>
                                {Object.entries(RESOURCE_INFO).map(([key, info]) => (
                                  <div key={key} className="flex items-center justify-between">
                                    <span>{info.emoji}</span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => adjustCounterDemand(key, -1)}
                                        className="w-4.5 h-4.5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] flex items-center justify-center font-bold text-[10px]"
                                      >
                                        -
                                      </button>
                                      <span className="font-extrabold text-[10px] w-3 text-center">{counterDemand[key] || 0}</span>
                                      <button
                                        onClick={() => adjustCounterDemand(key, 1)}
                                        className="w-4.5 h-4.5 rounded bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] flex items-center justify-center font-bold text-[10px]"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                const hasOffer = Object.values(counterOffer).some(q => q > 0);
                                const hasDemand = Object.values(counterDemand).some(q => q > 0);
                                if (!hasOffer || !hasDemand) return;
                                counterTrade(counterOffer, counterDemand);
                                setShowCounterForm(false);
                                setIsTradeOpen(false);
                              }}
                              disabled={!Object.values(counterOffer).some(q => q > 0) || !Object.values(counterDemand).some(q => q > 0)}
                              className="w-full py-2 bg-indigo-600 text-white font-extrabold rounded-xl text-[10px] uppercase disabled:opacity-50 cursor-pointer"
                            >
                              Submit Counter-Offer
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* BANK TRADE PANEL */}
            {tradeTab === 'bank' && (
              <div className="flex flex-col gap-4 text-center py-2">
                <span className="text-xs font-bold text-[color:var(--text-2)]">
                  Select a resource to offer ({myRatios[tradeOffer]}:1 ratio) and exchange for 1 of another type.
                </span>

                <div className="flex items-center justify-center gap-4 bg-[color:var(--surface-2)] p-4 border border-[color:var(--border)] rounded-2xl">
                  <div className="flex flex-col gap-1 text-left">
                    <span className="text-[9px] font-black uppercase text-emerald-400">Offer:</span>
                    <select
                      value={tradeOffer}
                      onChange={(e) => setTradeOffer(e.target.value)}
                      className="bg-[color:var(--surface-2)] border-2 border-[color:var(--border)] rounded-lg p-2 font-black text-xs text-[color:var(--text)] focus:outline-none"
                    >
                      {Object.entries(RESOURCE_INFO).map(([key, info]) => {
                        const ratio = myRatios[key];
                        return (
                          <option key={key} value={key}>
                            {ratio} {info.emoji} {info.name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <span className="font-extrabold text-[color:var(--muted)] text-lg">➡️</span>

                  <div className="flex flex-col gap-1 text-left">
                    <span className="text-[9px] font-black uppercase text-blue-400">Want:</span>
                    <select
                      value={tradeDemand}
                      onChange={(e) => setTradeDemand(e.target.value)}
                      className="bg-[color:var(--surface-2)] border-2 border-[color:var(--border)] rounded-lg p-2 font-black text-xs text-[color:var(--text)] focus:outline-none"
                    >
                      <option value="wood">1 🌲 Wood</option>
                      <option value="brick">1 🧱 Brick</option>
                      <option value="sheep">1 🐑 Sheep</option>
                      <option value="wheat">1 🌾 Wheat</option>
                      <option value="ore">1 ⛰️ Ore</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => {
                    handleBankTrade();
                    setIsTradeOpen(false);
                  }}
                  disabled={!isMyTurn || !gameState.diceRolled || !hasEnoughForBankTrade}
                  className="py-3 bg-indigo-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-xl shadow-[var(--shadow-1)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500 active:translate-y-[1px] active:shadow-none transition-all uppercase text-xs cursor-pointer"
                >
                  Trade with Bank
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 5. THE BOTTOM DECK (SPLIT DECK LAYOUT) ---------------- */}
      <div className="panel flex items-end gap-6 px-6 py-4 pointer-events-auto shrink-0 mx-auto max-w-[700px] mb-2" style={{ color: 'var(--text)' }}>
        {/* Left Half: Resource Cards (Compact view) */}
        <div className="flex flex-col gap-1.5 pr-6 shrink-0" style={{ borderRight: '1px solid var(--border)' }}>
          <span className="text-[9px] font-black text-[color:var(--muted)] uppercase tracking-wider">
            Resources
          </span>
          <div className="flex gap-1.5 select-none">
            {Object.entries(RESOURCE_INFO).map(([key, info]) => {
              const count = me ? me.resources[key] || 0 : 0;
              return (
                <div
                  key={key}
                  className={`w-12 h-18 flex flex-col items-center justify-between border-2 rounded-xl py-2 px-1 shadow-md transition-all ${info.style}`}
                >
                  <span className="text-xl">{info.emoji}</span>
                  <span className="text-[7px] font-black uppercase tracking-tight">{info.name}</span>
                  <span className="text-xs font-black bg-[color:var(--surface-2)] px-1 py-0.5 rounded">
                    x{count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Half: Development Cards Stack */}
        <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
          <span className="text-[9px] font-black text-[color:var(--muted)] uppercase tracking-wider">
            Development Cards
          </span>
          <div className="flex gap-4 items-end min-h-[110px] pb-1">
            {me && (me.devCards.length > 0 || (me.devCardsBoughtThisTurn && me.devCardsBoughtThisTurn.length > 0)) ? (
              cardTypes.map((type) => {
                const playableCount = playableGroups[type] || 0;
                const lockedCount = lockedGroups[type] || 0;
                return (
                  <React.Fragment key={type}>
                    {renderCardStack(type, playableCount, true, false)}
                    {renderCardStack(type, lockedCount, false, true)}
                  </React.Fragment>
                );
              })
            ) : (
              <span className="text-[10px] text-[color:var(--muted)] italic pb-6 font-bold uppercase tracking-wider">
                No cards in deck
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- 6. ACTION HUD (FLOATING BOTTOM RIGHT) ---------------- */}
      <div className="panel flex flex-col gap-3 p-4 pointer-events-auto shrink-0 min-w-[210px] mb-2 select-none" style={{ color: 'var(--text)' }}>
        <span className="text-[9px] font-black uppercase tracking-wider pb-1.5" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
          Action Center
        </span>

        {/* Dice Visuals — tumble while rolling, spring-settle on land */}
        <div className="flex items-center justify-center gap-3 p-2 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', perspective: 400 }}>
          {[0, 1].map((i) => {
            const val = isShaking ? shakingDice[i] : (gameState.lastDiceRoll ? gameState.lastDiceRoll[i] : 1);
            return (
              <motion.div
                key={i}
                className="w-12 h-12 bg-white rounded-xl flex items-center justify-center"
                style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-2)', transformStyle: 'preserve-3d' }}
                animate={isShaking
                  ? { rotateX: [0, -140, -300, -190, 0], rotateZ: [0, 22, -16, 8, 0], y: [0, -8, 3, -4, 0], scale: [1, 1.12, 0.95, 1.06, 1] }
                  : { rotateX: 0, rotateZ: 0, y: 0, scale: 1 }}
                transition={isShaking
                  ? { duration: 0.55, ease: 'easeInOut', delay: i * 0.06 }
                  : { type: 'spring', stiffness: 520, damping: 16 }}
              >
                {renderDiePips(val)}
              </motion.div>
            );
          })}
        </div>

        {/* Core Controls */}
        <div className="flex flex-col gap-1.5">
          {!gameState.diceRolled && isMyTurn ? (
            <button
              onClick={rollDice}
              className="w-full py-2.5 bg-indigo-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-xl shadow-[var(--shadow-1)] hover:bg-indigo-500 active:translate-y-[1px] active:shadow-none transition-all uppercase text-xs cursor-pointer"
            >
              Roll Dice 🎲
            </button>
          ) : isMyTurn ? (
            <button
              onClick={endTurn}
              className="w-full py-2.5 bg-red-500 text-white font-extrabold border-2 border-[color:var(--border)] rounded-xl shadow-[var(--shadow-1)] hover:bg-red-400 active:translate-y-[1px] active:shadow-none transition-all uppercase text-xs cursor-pointer"
            >
              End Turn ➡️
            </button>
          ) : (
            <button
              disabled
              className="w-full py-2.5 bg-[color:var(--surface-2)] text-[color:var(--muted)] border border-[color:var(--border)] rounded-xl uppercase text-xs opacity-50 cursor-not-allowed"
            >
              Opponent Turn
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={buyDevCard}
              disabled={!isMyTurn || !gameState.diceRolled || !hasEnoughForDev}
              className="flex-1 py-1.5 bg-blue-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-lg shadow-[var(--shadow-1)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 active:translate-y-[1px] active:shadow-none transition-all text-[9px] uppercase cursor-pointer"
            >
              Buy Card 📜
            </button>
            <button
              onClick={() => setIsTradeOpen(true)}
              disabled={!isMyTurn || !gameState.diceRolled}
              className="flex-1 py-1.5 bg-emerald-600 text-white font-extrabold border-2 border-[color:var(--border)] rounded-lg shadow-[var(--shadow-1)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-500 active:translate-y-[1px] active:shadow-none transition-all text-[9px] uppercase cursor-pointer"
            >
              Trade 🤝
            </button>
          </div>

        </div>
      </div>

      {/* ---------------- 7. DEV CARD MODAL CONFIRMATIONS (ON DROP) ---------------- */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-[color:var(--surface)] border border-[color:var(--border)] rounded-3xl p-6 max-w-[400px] w-full shadow-2xl flex flex-col gap-4 text-[color:var(--text)] border-[color:var(--border)]">
            
            {activeModal === 'Year of Plenty' && (
              <>
                <h2 className="text-xl font-black text-center flex items-center justify-center gap-2 border-b border-[color:var(--border)] pb-3">
                  <span>🌾</span> Year of Plenty
                </h2>
                <p className="text-xs font-bold text-[color:var(--text-2)] text-center">
                  Select exactly 2 resources to draw from the bank for free.
                </p>
                
                <div className="grid grid-cols-5 gap-1.5 my-2">
                  {Object.entries(RESOURCE_INFO).map(([key, info]) => {
                    const countInSel = yopSelection.filter((x) => x === key).length;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setYopSelection((prev) => {
                            const idx = prev.indexOf(key);
                            if (idx !== -1) {
                              const next = [...prev];
                              next.splice(idx, 1);
                              return next;
                            }
                            if (prev.length < 2) {
                              return [...prev, key];
                            }
                            return prev;
                          });
                        }}
                        className={`flex flex-col items-center justify-center border-2 border-[color:var(--border)] rounded-xl py-2 px-1 shadow-md hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none transition-all relative cursor-pointer ${info.style}`}
                      >
                        <span className="text-xl">{info.emoji}</span>
                        <span className="text-[7px] font-black uppercase mt-1 leading-none">{info.name}</span>
                        {countInSel > 0 && (
                          <div className="absolute -top-1.5 -right-1.5 bg-red-600 border border-[color:var(--border)] text-white font-black text-[9px] w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                            +{countInSel}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                
                <div className="text-xs font-black text-center text-indigo-300 h-6">
                  {yopSelection.length === 0 ? (
                    "Choose 2 resource cards"
                  ) : (
                    <span>
                      Selected:{" "}
                      {yopSelection.map((res, i) => (
                        <span key={i} className="inline-block bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] px-1.5 py-0.5 rounded mx-0.5 font-bold">
                          {RESOURCE_INFO[res].emoji}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                <div className="flex gap-3 mt-2">
                  <button
                    onClick={() => {
                      setYopSelection([]);
                      setActiveModal(null);
                    }}
                    className="flex-1 py-2 bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] font-bold rounded-xl text-xs uppercase shadow cursor-pointer active:translate-y-0.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (yopSelection.length !== 2) return;
                      playDevCard('Year of Plenty', { resources: yopSelection });
                      setYopSelection([]);
                      setActiveModal(null);
                    }}
                    disabled={yopSelection.length !== 2}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold border border-[color:var(--border)] rounded-xl text-xs uppercase shadow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-0.5"
                  >
                    Confirm 🌾
                  </button>
                </div>
              </>
            )}

            {activeModal === 'Monopoly' && (
              <>
                <h2 className="text-xl font-black text-center flex items-center justify-center gap-2 border-b border-[color:var(--border)] pb-3">
                  <span>💰</span> Monopoly Card
                </h2>
                <p className="text-xs font-bold text-[color:var(--text-2)] text-center">
                  Select a resource type. All other players must give you all resource cards of this type they currently hold in their hand.
                </p>
                
                <div className="grid grid-cols-5 gap-1.5 my-2">
                  {Object.entries(RESOURCE_INFO).map(([key, info]) => {
                    const isSelected = monopolyResource === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setMonopolyResource(key)}
                        className={`flex flex-col items-center justify-center border-2 rounded-xl py-2 px-1 transition-all cursor-pointer ${
                          isSelected
                            ? `${info.style} border-[color:var(--border)] ring-4 ring-slate-950/20 shadow-none translate-y-0.5`
                            : 'bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border-[color:var(--border)] text-[color:var(--text)] shadow hover:-translate-y-0.5'
                        }`}
                      >
                        <span className="text-xl">{info.emoji}</span>
                        <span className="text-[7px] font-black uppercase mt-1 leading-none">{info.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setActiveModal(null)}
                    className="flex-1 py-2 bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-2)] border border-[color:var(--border-strong)] font-bold rounded-xl text-xs uppercase shadow cursor-pointer active:translate-y-0.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      playDevCard('Monopoly', { resource: monopolyResource });
                      setActiveModal(null);
                    }}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold border border-[color:var(--border)] rounded-xl text-xs uppercase shadow cursor-pointer active:translate-y-0.5"
                  >
                    Claim Monopoly 💰
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

    </div>
  );
}

export default PlayerDashboard;
