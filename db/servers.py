"""This process in the game-server registry: registration, heartbeat, failover claims.

Env:
  PUBLIC_URL   URL clients use to reach this server's Socket.IO endpoint
               (default http://localhost:<port>)
  SERVER_REGION, MAX_ROOMS
"""
import os
import resource
import socket

from . import enabled, fetchrow, pool

server_id = None   # this process's game_servers.id once registered


async def register(public_url, version=None):
    global server_id
    if not enabled():
        return None
    row = await fetchrow(
        """insert into public.game_servers (hostname, public_url, region, version, max_rooms)
           values ($1, $2, $3, $4, $5) returning id::text""",
        socket.gethostname(), public_url, os.environ.get("SERVER_REGION"), version,
        int(os.environ.get("MAX_ROOMS", 200)))
    server_id = row["id"] if row else None
    return server_id


def _mem_mb():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 * 1024) if os.uname().sysname == "Darwin" else rss / 1024   # macOS: bytes, Linux: KB


async def heartbeat(active_rooms, connected_sockets):
    """Returns this server's status, or 'dead' if another server declared it dead
    (it must then drop its rooms: they have been taken over)."""
    if not server_id:
        return None
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
    row = await fetchrow(
        """update public.game_servers
           set last_heartbeat_at = now(), active_rooms = $2, connected_sockets = $3,
               cpu_percent = $4, mem_mb = $5
           where id = $1::uuid and status <> 'dead'
           returning status::text""",
        server_id, active_rooms, connected_sockets, load, _mem_mb())
    return row["status"] if row else "dead"


async def terminated_among(match_ids):
    """Which of these live matches an admin has terminated (admin_terminate_match)."""
    if not match_ids:
        return []
    rows = await pool().fetch(
        "select id::text from public.matches where id = any($1::uuid[]) and status = 'terminated'", match_ids)
    return [r[0] for r in rows]


async def set_status(status):
    if server_id:
        await fetchrow("update public.game_servers set status = $2::public.server_status where id = $1::uuid returning id",
                       server_id, status)


async def claim_orphans(limit=20):
    if not server_id:
        return []
    rows = await pool().fetch("select * from public.claim_orphaned_matches($1::uuid, $2)", server_id, limit)
    return [str(r[0]) for r in rows]


async def load_checkpoint(match_id):
    return await fetchrow(
        "select seq, turn_no, room from public.match_checkpoints where match_id = $1::uuid", match_id)


async def abandon(match_id, reason):
    await fetchrow(
        """update public.matches set status = 'abandoned', ended_at = now(), end_reason = $2
           where id = $1::uuid and status in ('lobby', 'setup', 'playing') returning id""", match_id, reason)
