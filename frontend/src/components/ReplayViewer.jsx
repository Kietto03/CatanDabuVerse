import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useRoute } from '../store/routeStore';
import {
  ReplayCursor, createShareLink, downloadReplay, fetchMatchReplay, fetchSharedReplay,
  readReplayFile, setPendingReplay, takePendingReplay,
} from '../lib/replay';
import { Button, Panel, Badge, IconButton, RES_COLOR } from '../ui';
import Scoreboard from './Scoreboard';
import ChatWidget from './ChatWidget';

const BoardCanvas = lazy(() => import('./BoardCanvas'));

const MODE_LABEL = { basic: 'Classic', seafarers: 'Seafarers', cities: 'Cities & Knights' };
const SPEEDS = [0.5, 1, 2, 4, 8];
const BASE_DELAY_MS = 900;
const RES_ICON = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' };
const COMMODITY_ICON = { coin: '🪙', cloth: '🧵', paper: '📜' };

function Centered({ children }) {
  return <div className="w-full max-w-[460px] p-4">{children}</div>;
}

function useReplaySource(route) {
  const [replay, setReplay] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = route.kind === 'match' ? fetchMatchReplay(route.id)
      : route.kind === 'share' ? fetchSharedReplay(route.token)
      : Promise.resolve(takePendingReplay()).then((r) => { if (!r) throw new Error('Chưa chọn file replay.'); return r; });
    load.then((r) => !cancelled && setReplay(r), (e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [route.kind, route.id, route.token]);
  return { replay, error };
}

export function OpenReplayFileButton({ children = '📂 Mở file replay', ...props }) {
  const navigate = useRoute((s) => s.navigate);
  const input = useRef(null);
  const [error, setError] = useState('');
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPendingReplay(await readReplayFile(file));
      setError('');
      navigate('/replay/file');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".catanreplay,.json,.gz,application/gzip,application/json" hidden onChange={onFile} />
      <Button variant="ghost" size="sm" onClick={() => input.current.click()} {...props}>{children}</Button>
      {error && <div role="alert" className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{error}</div>}
    </>
  );
}

function SeatHand({ slot, mode }) {
  if (!slot) return null;
  const cards = [...(slot.devCards || []), ...(slot.devCardsBoughtThisTurn || [])];
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(slot.resources || {}).map(([res, n]) => (
          <span key={res} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-extrabold"
                style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', borderBottom: `3px solid ${RES_COLOR[res] || 'var(--border)'}` }}>
            {RES_ICON[res]} {n}
          </span>
        ))}
      </div>
      {mode === 'cities' && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(slot.commodities || {}).map(([c, n]) => (
            <span key={c} className="text-xs font-bold px-2 py-0.5" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>{COMMODITY_ICON[c]} {n}</span>
          ))}
        </div>
      )}
      <div className="text-xs" style={{ color: 'var(--text-2)' }}>
        <b>Thẻ phát triển:</b> {cards.length ? cards.join(', ') : '—'}
        {mode === 'cities' && <><br /><b>Thẻ tiến bộ:</b> {(slot.progressCards || []).join(', ') || '—'}</>}
      </div>
    </div>
  );
}

function ReplayPlayer({ replay, route }) {
  const navigate = useRoute((s) => s.navigate);
  const cursor = useMemo(() => new ReplayCursor(replay), [replay]);
  const [index, setIndex] = useState(0);
  const [playRequested, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [viewAs, setViewAs] = useState('spectator');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Phones: start with the info panel folded so it doesn't cover the board.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const last = cursor.length - 1;
  const playing = playRequested && index < last;   // playback stops by itself at the end

  // Take over the game store while the viewer is mounted; give it back on exit.
  useEffect(() => {
    const live = useGameStore.getState().liveSocket;
    useGameStore.setState({ replayMode: true });
    return () => useGameStore.setState({ replayMode: false, socket: live, gameState: null, placementMode: null });
  }, []);
  useEffect(() => {
    const id = viewAs === 'spectator' ? '__spectator__' : `seat-${viewAs}`;
    useGameStore.setState({ socket: { id, connected: false, emit: () => {} } });
  }, [viewAs]);
  useEffect(() => {
    useGameStore.setState({ gameState: cursor.stateAt(index) });
  }, [cursor, index]);

  // Playback.
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), BASE_DELAY_MS / speed);
    return () => clearTimeout(t);
  }, [playing, index, speed, last]);

  const step = useCallback((d) => { setPlaying(false); setIndex((i) => Math.max(0, Math.min(last, i + d))); }, [last]);
  const jumpTurn = useCallback((d) => {
    setPlaying(false);
    const turn = cursor.turnOf(index);
    const starts = cursor.turnStarts;
    const pos = starts.findIndex((s) => s.turn === turn);
    const target = d < 0
      ? (starts[pos].index < index ? starts[pos] : starts[Math.max(0, pos - 1)])
      : starts[Math.min(starts.length - 1, pos + 1)];
    setIndex(target.index);
  }, [cursor, index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowRight') step(e.shiftKey ? 10 : 1);
      else if (e.key === 'ArrowLeft') step(e.shiftKey ? -10 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const run = async (fn) => {
    setBusy(true); setNotice('');
    try { await fn(); } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  };
  const share = () => run(async () => {
    const link = await createShareLink(replay.match.id);
    await navigator.clipboard.writeText(link).catch(() => {});
    setNotice(`Đã copy link: ${link}`);
  });

  const state = useGameStore((s) => s.gameState);
  const ev = cursor.event(index);
  const caption = ev?.log_lines?.length ? ev.log_lines[ev.log_lines.length - 1] : (index === 0 ? 'Bắt đầu ván' : ev?.type);
  const m = replay.match;
  const canExport = route.kind === 'match';
  const viewedSlot = viewAs === 'spectator' ? null : state?.slots?.[viewAs];

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none">
      <div className="absolute inset-0 z-0">
        <Suspense fallback={null}><BoardCanvas /></Suspense>
      </div>
      <div className="absolute top-0 left-0 w-full" style={{ zIndex: 'var(--z-panel)' }}><Scoreboard /></div>
      <div className="absolute top-20 sm:top-24 left-2 sm:left-3" style={{ zIndex: 'var(--z-panel)' }}><ChatWidget /></div>

      {/* Info + seat view */}
      <div className="absolute top-20 sm:top-24 right-2 sm:right-3 w-[min(19rem,calc(100vw-1rem))] flex flex-col items-end" style={{ zIndex: 'var(--z-panel)' }}>
        {!panelOpen ? (
          <div className="flex gap-1.5">
            <Button variant="solid" tone="neutral" size="sm" onClick={() => setPanelOpen(true)} style={{ boxShadow: 'var(--shadow-2)' }}>🎞️ Replay ▾</Button>
            <Button variant="solid" tone="neutral" size="sm" onClick={() => navigate('/')} style={{ boxShadow: 'var(--shadow-2)' }} aria-label="Thoát replay">✕</Button>
          </div>
        ) : (
        <Panel className="p-3.5 flex flex-col gap-3 w-full">
          <div className="flex items-start justify-between gap-2">
            <button className="text-left focusable" onClick={() => setPanelOpen(false)} aria-label="Thu gọn" title="Thu gọn">
              <div className="font-black text-sm">Replay · {m.room_code || m.id.slice(0, 8)}</div>
              <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {MODE_LABEL[m.mode] || m.mode} · {m.ended_at ? new Date(m.ended_at).toLocaleString('vi-VN') : ''} ▴
              </div>
            </button>
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>✕ Thoát</Button>
          </div>
          <label className="flex flex-col gap-1 text-left">
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Xem theo góc nhìn</span>
            <select value={viewAs} onChange={(e) => setViewAs(e.target.value === 'spectator' ? 'spectator' : Number(e.target.value))}
              className="focusable px-2 py-1.5 font-bold text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' }}>
              <option value="spectator">Khán giả</option>
              {replay.participants.map((p) => (
                <option key={p.seat} value={p.seat}>{p.display_name}{p.is_winner ? ' 🏆' : ''}</option>
              ))}
            </select>
          </label>
          {viewedSlot && <SeatHand slot={viewedSlot} mode={m.mode} />}
          {canExport && (
            <div className="flex gap-2">
              <Button variant="soft" tone="info" size="sm" className="flex-1" disabled={busy} onClick={share}>🔗 Chia sẻ</Button>
              <Button variant="soft" tone="accent" size="sm" className="flex-1" disabled={busy}
                onClick={() => run(() => downloadReplay(m.id))}>⬇️ Tải về</Button>
            </div>
          )}
          {notice && <div className="text-xs font-semibold break-all text-left" style={{ color: 'var(--text-2)' }}>{notice}</div>}
        </Panel>
        )}
      </div>

      {/* Transport controls */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-2 sm:p-3" style={{ zIndex: 'var(--z-panel)' }}>
        <Panel className="w-full max-w-[760px] px-3 py-2.5 flex flex-col gap-2">
          <div className="text-xs font-semibold truncate text-left" style={{ color: 'var(--text-2)' }} aria-live="polite">
            <Badge tone="accent">Lượt {cursor.turnOf(index)}</Badge> <span className="ml-1">{caption}</span>
          </div>
          <input type="range" min={0} max={last} value={index} aria-label="Vị trí replay"
            onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} className="w-full accent-[var(--accent)]" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <IconButton size={34} onClick={() => jumpTurn(-1)} aria-label="Lượt trước">⏮</IconButton>
              <IconButton size={34} onClick={() => step(-1)} aria-label="Lùi một bước">◀</IconButton>
              <Button size="sm" onClick={() => { if (index >= last) { setIndex(0); setPlaying(true); } else setPlaying(!playing); }} aria-label={playing ? 'Tạm dừng' : 'Phát'} style={{ minWidth: 72 }}>
                {playing ? '⏸ Dừng' : '▶ Phát'}
              </Button>
              <IconButton size={34} onClick={() => step(1)} aria-label="Tiến một bước">▶</IconButton>
              <IconButton size={34} onClick={() => jumpTurn(1)} aria-label="Lượt sau">⏭</IconButton>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Tốc độ">
              {SPEEDS.map((s) => (
                <button key={s} onClick={() => setSpeed(s)} className="focusable text-xs font-extrabold px-2 py-1"
                  style={{ borderRadius: 'var(--radius-sm)', background: speed === s ? 'var(--accent)' : 'var(--surface-2)', color: speed === s ? '#fff' : 'var(--text-2)' }}>
                  {s}×
                </button>
              ))}
            </div>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--muted)' }}>{index}/{last}</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function ReplayViewer({ route }) {
  const navigate = useRoute((s) => s.navigate);
  const { replay, error } = useReplaySource(route);
  if (error) {
    return (
      <Centered>
        <Panel className="p-7 flex flex-col gap-4 text-center">
          <div className="text-3xl" aria-hidden="true">🎞️</div>
          <h2 className="text-xl font-black">Không mở được replay</h2>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>{error}</p>
          <div className="flex flex-col items-center gap-2">
            <OpenReplayFileButton />
            <Button onClick={() => navigate('/')}>Về sảnh</Button>
          </div>
        </Panel>
      </Centered>
    );
  }
  if (!replay) {
    return (
      <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-2)' }}>
        <div className="board-spinner" aria-hidden="true" />
        <div className="text-sm font-semibold">Đang tải replay…</div>
      </div>
    );
  }
  return <ReplayPlayer replay={replay} route={route} />;
}
