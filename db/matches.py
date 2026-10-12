"""Match lifecycle writes: create → start → finish/abandon, plus chat and connection logs.

All writes except `create_match` go through `db.submit` (background, ordered
per match). Data is copied out of the live room *before* submitting, so later
in-memory changes can't leak into what gets recorded.
"""
import json
import logging
import uuid

import asyncpg

from . import enabled, fetchrow, owns_match, pool, submit
from . import servers

log = logging.getLogger("db.matches")


class RoomCodeTaken(Exception):
    pass


async def create_match(room, host_uid):
    """Insert the lobby row. The live-room-code unique index makes this a global
    lock on the code. Returns the match id, or None when persistence is off."""
    if not enabled():
        return None
    match_id = str(uuid.uuid4())
    settings = {
        "victoryPointsLimit": room["victoryPointsLimit"],
        "turnTimeoutLimit": room["turnTimeoutLimit"],
        "hideBankCards": room["hideBankCards"],
        "balancedDice": room["balancedDice"],
    }
    try:
        await pool().execute(
            """insert into public.matches (id, room_code, mode, map_id, status, settings, host_id, server_id)
               values ($1::uuid, $2, $3::public.game_mode, $4, 'lobby', $5::jsonb, $6::uuid, $7::uuid)""",
            match_id, room["code"], room["gameMode"], room["mapId"], json.dumps(settings), host_uid, servers.server_id)
    except asyncpg.UniqueViolationError as e:
        raise RoomCodeTaken(room["code"]) from e
    except Exception as e:  # noqa: BLE001 - play on without persistence
        log.error("create_match failed, room %s not persisted: %s", room["code"], e)
        return None
    return match_id


def participant_rows(room):
    return [{
        "seat": s["index"],
        "kind": "human" if s["type"] == "human" else "bot",
        "uid": s.get("uid"),
        "bot_type": None if s["type"] == "human" else s["type"],
        "name": s["username"] or "?",
        "color": s["color"],
    } for s in room["slots"]]


async def _start(conn, match_id, rows):
    async with conn.transaction():
        await conn.execute(
            "update public.matches set status = 'playing', started_at = now() where id = $1::uuid", match_id)
        await conn.executemany(
            """insert into public.match_participants
                 (match_id, seat_index, turn_order, kind, user_id, bot_type, display_name, color)
               values ($1::uuid, $2, $2, $3::public.seat_kind, $4::uuid, $5, $6, $7)""",
            [(match_id, r["seat"], r["kind"], r["uid"], r["bot_type"], r["name"], r["color"]) for r in rows])


def start_match(room):
    submit(room.get("matchId"), _start, room["matchId"], participant_rows(room))


def _final_vp(slot):
    if slot.get("vpCardsCounted"):      # check_victory already folded VP cards in
        return slot["victoryPoints"]
    cards = slot.get("devCards", []) + slot.get("devCardsBoughtThisTurn", [])
    return slot["victoryPoints"] + cards.count("Victory Point")


def _slot_stats(room, slot):
    idx = slot["index"]
    board = room["board"]
    return {
        "settlements": sum(1 for v in board["vertices"] if v["owner"] == idx and v["building"] == "settlement"),
        "cities": sum(1 for v in board["vertices"] if v["owner"] == idx and v["building"] == "city"),
        "roads": sum(1 for e in board["edges"] if e["owner"] == idx and e.get("type") != "ship"),
        "ships": sum(1 for e in board["edges"] if e["owner"] == idx and e.get("type") == "ship"),
        "knights_played": slot.get("knightsPlayed", 0),
        "longest_road": room.get("longestRoadHolder") == idx,
        "largest_army": room.get("largestArmyHolder") == idx,
        "metropolis": list(slot.get("metropolis", [])),
    }


async def _finish(conn, match_id, mode, winner_seat, results, owner=None):
    async with conn.transaction():
        if not await owns_match(conn, match_id, owner):
            return
        done = await conn.fetchval(
            """update public.matches
               set status = 'finished', ended_at = now(), end_reason = 'victory',
                   replay_expires_at = now() + make_interval(days => coalesce(
                     (select (value #>> '{}')::int from public.app_config where key = 'replay_retention_days'), 7))
               where id = $1::uuid and status <> 'finished'
               returning id""", match_id)
        if not done:                     # already finalized: idempotent
            return
        for r in results:
            pid = await conn.fetchval(
                """update public.match_participants
                   set final_vp = $3, placement = $4, is_winner = $5, stats = $6::jsonb
                   where match_id = $1::uuid and seat_index = $2 returning id""",
                match_id, r["seat"], r["vp"], r["placement"], r["seat"] == winner_seat, json.dumps(r["stats"]))
            if r["seat"] == winner_seat:
                await conn.execute(
                    "update public.matches set winner_participant_id = $2 where id = $1::uuid", match_id, pid)
            if r["uid"]:
                win = r["seat"] == winner_seat
                await conn.execute(
                    """insert into public.player_stats as ps
                         (user_id, mode, games_played, wins, total_vp, longest_road, largest_army, current_streak, best_streak)
                       values ($1::uuid, $2::public.game_mode, 1, $3::int, $4, $5::int, $6::int, $3::int, $3::int)
                       on conflict (user_id, mode) do update set
                         games_played   = ps.games_played + 1,
                         wins           = ps.wins + excluded.wins,
                         total_vp       = ps.total_vp + excluded.total_vp,
                         longest_road   = ps.longest_road + excluded.longest_road,
                         largest_army   = ps.largest_army + excluded.largest_army,
                         current_streak = case when excluded.wins = 1 then ps.current_streak + 1 else 0 end,
                         best_streak    = greatest(ps.best_streak,
                                            case when excluded.wins = 1 then ps.current_streak + 1 else 0 end),
                         updated_at     = now()""",
                    r["uid"], mode, int(win), r["vp"], int(r["stats"]["longest_road"]), int(r["stats"]["largest_army"]))


def finish_match(room, winner_slot):
    """Record the result once. Safe to call from every game-over code path."""
    if room.get("finalized"):
        return
    room["finalized"] = True
    results = [{"seat": s["index"], "uid": s.get("uid"), "vp": _final_vp(s), "stats": _slot_stats(room, s)}
               for s in room["slots"]]
    # Placement: winner first, then by VP.
    order = sorted(results, key=lambda r: (r["seat"] != winner_slot["index"], -r["vp"]))
    for place, r in enumerate(order, 1):
        r["placement"] = place
    submit(room.get("matchId"), _finish, room["matchId"], room["gameMode"], winner_slot["index"], results, servers.server_id)


async def _abandon(conn, match_id, reason, owner=None):
    async with conn.transaction():
        if await owns_match(conn, match_id, owner):
            await _abandon_now(conn, match_id, reason)


async def _abandon_now(conn, match_id, reason):
    await conn.execute(
        """update public.matches set status = 'abandoned', ended_at = now(), end_reason = $2
           where id = $1::uuid and status in ('lobby', 'setup', 'playing')""", match_id, reason)


def abandon_match(room, reason):
    if room.get("finalized"):
        return
    room["finalized"] = True
    submit(room.get("matchId"), _abandon, room["matchId"], reason, servers.server_id)


async def _chat(conn, match_id, uid, seat, body):
    await conn.execute(
        """insert into public.chat_messages (match_id, sender_id, sender_seat, body)
           values ($1::uuid, $2::uuid, $3, $4)""", match_id, uid, seat, body[:500])


def log_chat(room, slot, body):
    submit(room.get("matchId"), _chat, room["matchId"], slot.get("uid"), slot["index"], body)


async def abandon_orphans_on_boot():
    """Single-server mode: any live match left from a previous process is dead.
    (Multi-server failover replaces this in roadmap step 5.)"""
    if not enabled():
        return
    n = await pool().execute(
        """update public.matches set status = 'abandoned', ended_at = now(), end_reason = 'server_restart'
           where status in ('lobby', 'setup', 'playing') and server_id is null""")
    log.info("boot cleanup: %s", n)


# ---- connection log (not tied to a match's write order) ----

async def open_connection(uid, socket_id, ip_hash, user_agent):
    await fetchrow("update public.profiles set last_seen_at = now() where id = $1::uuid returning id", uid)
    row = await fetchrow(
        """insert into public.connection_sessions (user_id, socket_id, ip_hash, user_agent)
           values ($1::uuid, $2, $3, $4) returning id""", uid, socket_id, ip_hash, (user_agent or "")[:300])
    return row["id"] if row else None


async def close_connection(conn_id, reason):
    if conn_id:
        await fetchrow(
            """update public.connection_sessions set disconnected_at = now(), disconnect_reason = $2
               where id = $1 returning id""", conn_id, reason)


async def attach_connection(conn_id, match_id):
    if conn_id and match_id:
        await fetchrow("update public.connection_sessions set match_id = $2::uuid where id = $1 returning id",
                       conn_id, match_id)
