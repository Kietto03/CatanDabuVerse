"""Postgres (Supabase) persistence for the game server.

The game stays authoritative in memory; this package only records what must
outlive a process: identities, matches, results, chat and connection logs.
Every call degrades to a no-op when DATABASE_URL is unset or the database is
down, so a database outage never stops a game.

Env:
  DATABASE_URL   postgres connection string (service role: bypasses RLS)
"""
import asyncio
import logging
import os

import asyncpg

log = logging.getLogger("db")

_pool = None
_tasks = set()          # keep references so background writes aren't GC'd
_match_locks = {}       # match_id -> asyncio.Lock (FIFO ordering of writes per match)


def enabled():
    return _pool is not None


async def init():
    global _pool
    url = os.environ.get("DATABASE_URL")
    if not url:
        log.warning("DATABASE_URL not set: matches will not be persisted")
        return
    try:
        # Supabase's transaction pooler (port 6543) can't keep prepared statements
        # between transactions; the session pooler (5432) can. Work with both.
        extra = {"statement_cache_size": 0} if ":6543/" in url else {}
        _pool = await asyncpg.create_pool(url, min_size=1, max_size=10, command_timeout=10, **extra)
        log.info("database pool ready")
    except Exception as e:  # noqa: BLE001 - keep serving games without a DB
        log.error("database unavailable, running without persistence: %s", e)
        _pool = None


async def wait_pending():
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def close():
    await wait_pending()
    if _pool:
        await _pool.close()


def pool():
    return _pool


async def owns_match(conn, match_id, owner):
    """Fencing for multi-server: lock the match row and confirm `owner` (the server
    that queued the write) still owns it. A server declared dead may keep running
    for a few seconds; its late writes must not land after another server took over."""
    if owner is None:
        return True
    current = await conn.fetchval("select server_id::text from public.matches where id = $1::uuid for update", match_id)
    return current is None or current == owner


async def fetchrow(sql, *args):
    if not _pool:
        return None
    try:
        return await _pool.fetchrow(sql, *args)
    except Exception as e:  # noqa: BLE001
        log.error("query failed: %s | %s", e, sql.split("\n")[0])
        return None


def submit(match_id, fn, *args):
    """Run `await fn(conn, *args)` in the background, in submission order per match.

    Game handlers call this without awaiting, so a slow database never delays a move.
    """
    if not _pool or not match_id:
        return

    lock = _match_locks.setdefault(match_id, asyncio.Lock())

    async def run():
        async with lock:
            try:
                async with _pool.acquire() as conn:
                    await fn(conn, *args)
            except Exception as e:  # noqa: BLE001
                log.error("background write %s failed: %s", fn.__name__, e)

    task = asyncio.create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def forget_match(match_id):
    _match_locks.pop(match_id, None)
