import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore';

const COMMODITY = { coin: { e: '🪙', n: 'Coin' }, cloth: { e: '🧵', n: 'Cloth' }, paper: { e: '📜', n: 'Paper' } };
const TRACKS = [
  { key: 'science', label: 'Science', color: '#16a34a', commodity: 'paper' },
  { key: 'trade', label: 'Trade', color: '#eab308', commodity: 'cloth' },
  { key: 'politics', label: 'Politics', color: '#2563eb', commodity: 'coin' },
];
const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const RES_EMOJI = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' };

// Cards playable straight from the hand (no board target needed)
const SIMPLE_CARDS = new Set(['Smith', 'Irrigation', 'Mining', 'Engineer', 'Crane', 'Medicine',
  'Warlord', 'Saboteur', 'Wedding', 'Commercial Harbor', 'Road Building', 'Bishop']);
// Cards whose parameters are picked in-panel
const PARAM_CARDS = new Set(['Resource Monopoly', 'Trade Monopoly', 'Merchant Fleet', 'Alchemist', 'Spy', 'Master Merchant']);
// Cards needing a board selection (routed via placementMode)
const BOARD_CARDS = new Set(['Merchant', 'Inventor', 'Deserter', 'Intrigue', 'Diplomat']);

function Btn({ onClick, disabled, children, tone = 'slate' }) {
  const tones = {
    slate: { background: 'var(--surface-2)', color: 'var(--text)' },
    green: { background: 'var(--success)', color: '#fff' },
    amber: { background: 'var(--accent)', color: '#fff' },
    red: { background: 'var(--danger)', color: '#fff' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="focusable text-[11px] font-bold px-2.5 py-1 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px"
      style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-1)', ...tones[tone] }}
    >
      {children}
    </button>
  );
}

export default function ExpansionPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const socket = useGameStore((s) => s.socket);
  const upgradeCityImprovement = useGameStore((s) => s.upgradeCityImprovement);
  const buildCityWall = useGameStore((s) => s.buildCityWall);
  const activateKnight = useGameStore((s) => s.activateKnight);
  const promoteKnight = useGameStore((s) => s.promoteKnight);
  const playProgressCard = useGameStore((s) => s.playProgressCard);
  const chooseGold = useGameStore((s) => s.chooseGold);
  const bankTrade = useGameStore((s) => s.bankTrade);
  const setPlacementMode = useGameStore((s) => s.setPlacementMode);
  const placementMode = useGameStore((s) => s.placementMode);

  // Collapse by default on narrow viewports so it doesn't cover the board.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  const [cardParam, setCardParam] = useState(null); // {card, res, com, d1, d2, target}
  const [gold, setGold] = useState({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const [thOffer, setThOffer] = useState('coin');   // Trade House: commodity to pay
  const [thDemand, setThDemand] = useState('wood'); // Trade House: resource/commodity to get

  if (!gameState) return null;
  const mode = gameState.gameMode;
  if (mode !== 'cities' && mode !== 'seafarers') return null;

  const me = gameState.slots.find((s) => s.id === socket.id);
  if (!me) return null;
  const isMyTurn = gameState.slots[gameState.currentPlayerIndex]?.id === socket.id;
  const canBuild = isMyTurn && gameState.gameState === 'playing' && gameState.diceRolled;

  // ---- Seafarers gold choice ----
  const goldOwed = (gameState.goldPending && gameState.goldPending[me.index]) || 0;
  const goldSelected = Object.values(gold).reduce((a, b) => a + b, 0);

  // ---- Knights on the board owned by me ----
  const myKnights = gameState.board.vertices
    .filter((v) => v.knight && v.knight.owner === me.index)
    .map((v) => ({ vid: v.id, ...v.knight }));

  const otherName = (idx) => gameState.slots[idx]?.username || `P${idx}`;

  const playSimple = (card) => { playProgressCard(card); };
  const submitParam = () => {
    const p = cardParam;
    if (!p) return;
    if (p.card === 'Resource Monopoly') playProgressCard(p.card, { resource: p.res || 'wood' });
    else if (p.card === 'Trade Monopoly') playProgressCard(p.card, { commodity: p.com || 'coin' });
    else if (p.card === 'Merchant Fleet') playProgressCard(p.card, { resource: p.res || 'wood' });
    else if (p.card === 'Alchemist') playProgressCard(p.card, { d1: p.d1 || 1, d2: p.d2 || 1 });
    else if (p.card === 'Spy') playProgressCard(p.card, { target: p.target, progressCard: p.pcard });
    else if (p.card === 'Master Merchant') playProgressCard(p.card, { target: p.target });
    setCardParam(null);
  };

  const opponents = gameState.slots.filter((s) => s.type !== 'empty' && s.index !== me.index);

  return (
    <div className="panel w-64 max-h-[82vh] overflow-y-auto" style={{ color: 'var(--text)' }}>
      <div className="flex items-center justify-between px-3 py-2 rounded-t-2xl" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <span className="font-black text-sm">{mode === 'cities' ? '🏛️ Cities & Knights' : '⛵ Seafarers'}</span>
        <button onClick={() => setCollapsed((c) => !c)} className="text-xs font-bold px-2 py-0.5 border border-[color:var(--border)] rounded bg-white">
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-3">
          {/* ---------- Resource choice (Seafarers gold / C&K Aqueduct) ---------- */}
          {goldOwed > 0 && (
            <div className="border-2 border-amber-500 rounded-lg p-2 bg-amber-50">
              <div className="text-xs font-black mb-1">
                ✨ {mode === 'cities' ? 'Aqueduct' : 'Gold field'}: pick {goldOwed} resource{goldOwed > 1 ? 's' : ''}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {RESOURCES.map((r) => (
                  <div key={r} className="flex flex-col items-center">
                    <span>{RES_EMOJI[r]}</span>
                    <input type="number" min="0" value={gold[r]} className="w-9 text-center border border-[color:var(--border-strong)] rounded text-[11px]"
                      onChange={(e) => setGold({ ...gold, [r]: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                ))}
              </div>
              <Btn tone="green" disabled={goldSelected !== goldOwed}
                onClick={() => { chooseGold(gold); setGold({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }); }}>
                Confirm ({goldSelected}/{goldOwed})
              </Btn>
            </div>
          )}
          {/* ---------- SEAFARERS ---------- */}
          {mode === 'seafarers' && (
            <>
              <div className="flex flex-col gap-2">
                <Btn tone="green" disabled={!canBuild}
                  onClick={() => setPlacementMode(placementMode?.kind === 'ship' ? null : { kind: 'ship' })}>
                  {placementMode?.kind === 'ship' ? '✓ Click a sea edge…' : '⛵ Build Ship (1🌲 1🐑)'}
                </Btn>
                <Btn disabled={!canBuild}
                  onClick={() => setPlacementMode(placementMode?.kind === 'moveShipFrom' ? null : { kind: 'moveShipFrom' })}>
                  {placementMode?.kind?.startsWith('moveShip') ? '✓ Pick ship / target…' : '↔ Move Ship'}
                </Btn>
              </div>
            </>
          )}

          {/* ---------- CITIES & KNIGHTS ---------- */}
          {mode === 'cities' && (
            <>
              {/* Barbarian track + event die */}
              <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--surface-2)]">
                <div className="flex justify-between items-center text-xs font-black mb-1">
                  <span>☠️ Barbarians</span>
                  <span>{gameState.barbarianStep || 0}/7</span>
                </div>
                <div className="flex gap-0.5">
                  {[...Array(7)].map((_, i) => (
                    <div key={i} className={`h-2 flex-1 rounded-sm border border-[color:var(--border)] ${i < (gameState.barbarianStep || 0) ? 'bg-red-600' : 'bg-white'}`} />
                  ))}
                </div>
                {gameState.eventDie && (
                  <div className="text-[10px] font-bold text-slate-500 mt-1">Event die: {gameState.eventDie}</div>
                )}
              </div>

              {/* Commodities */}
              <div className="flex justify-around border border-[color:var(--border)] rounded-lg p-1.5 bg-[color:var(--surface-2)]">
                {Object.entries(COMMODITY).map(([k, v]) => (
                  <div key={k} className="flex flex-col items-center text-xs font-bold">
                    <span className="text-lg leading-none">{v.e}</span>
                    <span>{(me.commodities && me.commodities[k]) || 0}</span>
                  </div>
                ))}
              </div>

              {/* City improvements */}
              <div className="flex flex-col gap-1.5">
                {TRACKS.map((t) => {
                  const lvl = (me.improvements && me.improvements[t.key]) || 0;
                  const cost = lvl + 1;
                  const have = (me.commodities && me.commodities[t.commodity]) || 0;
                  const holder = gameState.metropolisHolders && gameState.metropolisHolders[t.key];
                  const mine = holder === me.index;
                  return (
                    <div key={t.key} className="flex items-center gap-2">
                      <div className="w-14 text-[11px] font-black" style={{ color: t.color }}>{t.label}</div>
                      <div className="flex gap-0.5 flex-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <div key={n} className="h-3 flex-1 rounded-sm border border-[color:var(--border-strong)]"
                            style={{ background: n <= lvl ? t.color : 'white' }} />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        {holder != null && (
                          <span className="text-[10px] font-black" title="Metropolis (level 4)">{mine ? '🏛️you' : '🏛️'}</span>
                        )}
                        {lvl < 5 && (
                          <Btn disabled={!canBuild || have < cost} onClick={() => upgradeCityImprovement(t.key)}>
                            +{cost}{COMMODITY[t.commodity].e}
                          </Btn>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Trade House (Trade improvement level >= 3): 2 commodities -> 1 any */}
              {((me.improvements && me.improvements.trade) || 0) >= 3 && (
                <div className="border-2 border-yellow-600 rounded-lg p-2 bg-yellow-50 flex flex-col gap-1">
                  <div className="text-[11px] font-black">🏪 Trade House (2:1)</div>
                  <div className="flex items-center gap-1 text-[11px] font-bold">
                    <span>Pay 2</span>
                    <select value={thOffer} onChange={(e) => setThOffer(e.target.value)} className="border border-[color:var(--border-strong)] rounded px-0.5">
                      {Object.keys(COMMODITY).map((c) => <option key={c} value={c}>{COMMODITY[c].e}</option>)}
                    </select>
                    <span>→ 1</span>
                    <select value={thDemand} onChange={(e) => setThDemand(e.target.value)} className="border border-[color:var(--border-strong)] rounded px-0.5">
                      {RESOURCES.map((r) => <option key={r} value={r}>{RES_EMOJI[r]}</option>)}
                      {Object.keys(COMMODITY).map((c) => <option key={c} value={c}>{COMMODITY[c].e}</option>)}
                    </select>
                  </div>
                  <Btn tone="green" disabled={!canBuild || thOffer === thDemand || ((me.commodities && me.commodities[thOffer]) || 0) < 2}
                    onClick={() => bankTrade(thOffer, thDemand)}>
                    Trade
                  </Btn>
                </div>
              )}

              {/* Knights & city actions */}
              <div className="flex flex-wrap gap-1.5">
                <Btn tone="green" disabled={!canBuild}
                  onClick={() => setPlacementMode(placementMode?.kind === 'knight' ? null : { kind: 'knight' })}>
                  {placementMode?.kind === 'knight' ? '✓ Click a spot…' : '⚔️ Recruit (1⛰️ 1🐑)'}
                </Btn>
                <Btn disabled={!canBuild} onClick={buildCityWall}>🧱 Wall (2🧱)</Btn>
              </div>

              {myKnights.length > 0 && (
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--surface-2)]">
                  <div className="text-[11px] font-black mb-1">Your Knights</div>
                  <div className="flex flex-col gap-1">
                    {myKnights.map((k) => (
                      <div key={k.vid} className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold">
                          {'⚔️'.repeat(k.level)} {k.active ? '🟢' : '⚪'}
                        </span>
                        <div className="flex gap-1">
                          {!k.active && (
                            <Btn disabled={!canBuild || k.builtThisTurn} onClick={() => activateKnight(k.vid)}>Act 1🌾</Btn>
                          )}
                          {k.level < 3 && (
                            <Btn disabled={!canBuild} onClick={() => promoteKnight(k.vid)}>↑ 1⛰️1🐑</Btn>
                          )}
                          <Btn disabled={!canBuild || !k.active}
                            onClick={() => setPlacementMode({ kind: 'moveKnightFrom', data: { from: k.vid } })}>Move</Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress cards */}
              {me.progressCards && me.progressCards.length > 0 && (
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-indigo-50">
                  <div className="text-[11px] font-black mb-1">Progress Cards ({me.progressCards.length}/4)</div>
                  <div className="flex flex-col gap-1">
                    {me.progressCards.map((card, i) => (
                      <div key={i} className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold">{card}</span>
                        {SIMPLE_CARDS.has(card) && <Btn tone="green" disabled={!canBuild && card !== 'Alchemist'} onClick={() => playSimple(card)}>Play</Btn>}
                        {PARAM_CARDS.has(card) && <Btn tone="amber" onClick={() => setCardParam({ card, res: 'wood', com: 'coin', d1: 1, d2: 1, target: opponents[0]?.index })}>Play…</Btn>}
                        {BOARD_CARDS.has(card) && (
                          <Btn tone="amber" disabled={!canBuild}
                            onClick={() => setPlacementMode({ kind: 'progressCard', data: { card } })}>Select…</Btn>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- Param modal for progress cards ---- */}
      {cardParam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCardParam(null)}>
          <div className="panel p-4 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="font-black mb-2">{cardParam.card}</div>
            {(cardParam.card === 'Resource Monopoly' || cardParam.card === 'Merchant Fleet') && (
              <div className="grid grid-cols-5 gap-1 mb-3">
                {RESOURCES.map((r) => (
                  <button key={r} onClick={() => setCardParam({ ...cardParam, res: r })}
                    className={`p-1 rounded border-2 ${cardParam.res === r ? 'border-emerald-600 bg-emerald-50' : 'border-slate-400'}`}>{RES_EMOJI[r]}</button>
                ))}
              </div>
            )}
            {cardParam.card === 'Trade Monopoly' && (
              <div className="grid grid-cols-3 gap-1 mb-3">
                {Object.keys(COMMODITY).map((c) => (
                  <button key={c} onClick={() => setCardParam({ ...cardParam, com: c })}
                    className={`p-1 rounded border-2 ${cardParam.com === c ? 'border-emerald-600 bg-emerald-50' : 'border-slate-400'}`}>{COMMODITY[c].e}</button>
                ))}
              </div>
            )}
            {cardParam.card === 'Alchemist' && (
              <div className="flex gap-2 mb-3">
                {['d1', 'd2'].map((d) => (
                  <select key={d} value={cardParam[d]} onChange={(e) => setCardParam({ ...cardParam, [d]: parseInt(e.target.value) })}
                    className="border-2 border-slate-400 rounded p-1 flex-1">
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                ))}
              </div>
            )}
            {(cardParam.card === 'Spy' || cardParam.card === 'Master Merchant') && (
              <select value={cardParam.target} onChange={(e) => setCardParam({ ...cardParam, target: parseInt(e.target.value) })}
                className="border-2 border-slate-400 rounded p-1 w-full mb-3">
                {opponents.map((o) => <option key={o.index} value={o.index}>{o.username}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              <Btn tone="green" onClick={submitParam}>Play</Btn>
              <Btn tone="red" onClick={() => setCardParam(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
