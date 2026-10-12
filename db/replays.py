"""Replay recording: keyframes + JSON-Patch frames, written in order per match.

A replay is `match_snapshots` (full states; seq 0 = right after the game starts,
then every KEYFRAME_EVERY events) plus `match_events` (one JSON Patch per
state change). The viewer rebuilds any frame as nearest keyframe + patches.

The server builds the *replay state* (every hand revealed, socket ids replaced
by seat ids, deck order never included) and passes it to `record()` after each
broadcast; this module only diffs, buffers and persists.
"""
import contextvars
import json

import jsonpatch

from . import enabled, fetchrow, owns_match, servers, submit
from .recovery import encode_room

# What caused the state change being recorded: a socket event name, 'bot',
# 'timeout' or 'system'. Set by the server around handlers and bot/timeout tasks.
current_action = contextvars.ContextVar("current_action", default=("system", None, None))

KEYFRAME_EVERY = 50
FLUSH_EVERY = 25


async def load_config():
    global KEYFRAME_EVERY
    row = await fetchrow("select (value #>> '{}')::int as n from public.app_config where key = 'replay_keyframe_every'")
    if row and row["n"]:
        KEYFRAME_EVERY = max(5, row["n"])


def _plain(state):
    # JSON round-trip: what the client would receive (int dict keys -> str, no aliasing).
    return json.loads(json.dumps(state))


async def _write(conn, match_id, events, keyframes, checkpoint=None, owner=None):
    async with conn.transaction():
        if not await owns_match(conn, match_id, owner):
            return
        if keyframes:
            await conn.executemany(
                """insert into public.match_snapshots (match_id, seq, state) values ($1::uuid, $2, $3::jsonb)
                   on conflict (match_id, seq) do nothing""",
                [(match_id, seq, json.dumps(state)) for seq, state in keyframes])
        if events:
            await conn.executemany(
                """insert into public.match_events (match_id, seq, turn_no, actor_seat, type, payload, patch, log_lines)
                   values ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
                   on conflict (match_id, seq) do nothing""",
                [(match_id, e["seq"], e["turn"], e["actor"], e["type"], json.dumps(e["payload"]),
                  json.dumps(e["patch"]), e["log"]) for e in events])
        if checkpoint:
            seq, turn, room = checkpoint
            # Only while the match is live: a late write must not resurrect a closed one.
            await conn.execute(
                """insert into public.match_checkpoints (match_id, seq, turn_no, room)
                   select $1::uuid, $2, $3, $4::jsonb from public.matches
                   where id = $1::uuid and status in ('setup', 'playing')
                   on conflict (match_id) do update
                     set seq = excluded.seq, turn_no = excluded.turn_no, room = excluded.room, updated_at = now()
                     where public.match_checkpoints.seq <= excluded.seq""",
                match_id, seq, turn, json.dumps(room))


def start(room, state):
    """Begin recording at game start; `state` becomes keyframe 0."""
    if not enabled() or not room.get("matchId"):
        return
    state = _plain(state)
    room["_replay"] = {"seq": 0, "turn": 0, "prev": state, "events": [], "keyframes": [(0, state)],
                       "lastPlayer": state.get("currentPlayerIndex"), "logLen": len(state.get("gameLog", []))}
    flush(room)


def record(room, state):
    rec = room.get("_replay")
    if not rec:
        return
    state = _plain(state)
    patch = jsonpatch.make_patch(rec["prev"], state).patch
    if not patch:
        return
    action, actor_seat, payload = current_action.get()
    if state.get("currentPlayerIndex") != rec["lastPlayer"]:
        rec["turn"] += 1
        rec["lastPlayer"] = state.get("currentPlayerIndex")
    rec["seq"] += 1
    log = state.get("gameLog", [])
    rec["events"].append({
        "seq": rec["seq"], "turn": rec["turn"],
        "actor": actor_seat if actor_seat is not None else state.get("currentPlayerIndex"),
        "type": action, "payload": payload if payload is not None else {},
        "patch": patch, "log": log[rec["logLen"]:],
    })
    rec["logLen"] = len(log)
    rec["prev"] = state
    over = state.get("gameState") == "gameover"
    if rec["seq"] % KEYFRAME_EVERY == 0 or over:
        rec["keyframes"].append((rec["seq"], state))
    if over or len(rec["events"]) >= FLUSH_EVERY or rec["turn"] != rec.get("flushedTurn"):
        flush(room)
        rec["flushedTurn"] = rec["turn"]
    if over:
        room.pop("_replay", None)   # recording ends with the final frame


def flush(room, checkpoint=True):
    """Persist buffered frames, plus a full-room checkpoint for crash recovery
    (the room as of the last recorded frame, so replay and checkpoint agree)."""
    rec = room.get("_replay")
    if not rec or not (rec["events"] or rec["keyframes"]):
        return
    events, keyframes = rec["events"], rec["keyframes"]
    rec["events"], rec["keyframes"] = [], []
    cp = None
    if checkpoint and room.get("gameState") != "gameover":
        cp = (rec["seq"], rec["turn"], encode_room(room))
    submit(room["matchId"], _write, room["matchId"], events, keyframes, cp, servers.server_id)


def checkpoint_now(room):
    """Write a checkpoint even with no pending frames (graceful shutdown)."""
    rec = room.get("_replay")
    if not rec or room.get("gameState") == "gameover":
        return
    submit(room["matchId"], _write, room["matchId"], rec["events"], rec["keyframes"],
           (rec["seq"], rec["turn"], encode_room(room)), servers.server_id)
    rec["events"], rec["keyframes"] = [], []


async def recorded_state(match_id, seq):
    """The replay state exactly as recorded up to `seq` (nearest keyframe + patches).
    A restored match continues its replay from this, so any drift between the
    checkpoint and the recording becomes an ordinary patch instead of a broken chain."""
    from . import pool
    kf = await fetchrow(
        """select seq, state from public.match_snapshots
           where match_id = $1::uuid and seq <= $2 order by seq desc limit 1""", match_id, seq)
    if not kf:
        return None
    doc = json.loads(kf["state"])
    rows = await pool().fetch(
        """select patch from public.match_events
           where match_id = $1::uuid and seq > $2 and seq <= $3 order by seq""", match_id, kf["seq"], seq)
    for r in rows:
        doc = jsonpatch.apply_patch(doc, json.loads(r["patch"]), in_place=True)
    return doc


def resume(room, state, seq, turn):
    """Continue recording a match restored from a checkpoint taken at `seq`."""
    state = _plain(state)
    room["_replay"] = {"seq": seq, "turn": turn, "prev": state, "events": [], "keyframes": [],
                       "lastPlayer": state.get("currentPlayerIndex"), "logLen": len(state.get("gameLog", [])),
                       "flushedTurn": turn}
