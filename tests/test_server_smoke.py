"""Boot the real server (no database, no login) and play the opening of a game
over Socket.IO, the same way the browser does."""
import asyncio
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
import socketio

ROOT = Path(__file__).resolve().parents[1]


def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='module')
def server():
    port = _free_port()
    env = {**os.environ, 'DATABASE_URL': '', 'SUPABASE_URL': '', 'PYTHONUNBUFFERED': '1'}
    # The server mounts frontend/dist; CI's backend job doesn't build it.
    (ROOT / 'frontend' / 'dist').mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'server:socket_app', '--port', str(port), '--app-dir', str(ROOT)],
        cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = f'http://127.0.0.1:{port}'
    for _ in range(60):
        try:
            urllib.request.urlopen(f'{url}/api/maps', timeout=1)
            break
        except Exception:
            if proc.poll() is not None:
                pytest.fail(f'server exited:\n{proc.stdout.read()}')
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail('server did not start')
    yield url
    proc.terminate()
    proc.wait(timeout=10)


def test_maps_endpoint(server):
    import json
    maps = json.load(urllib.request.urlopen(f'{server}/api/maps'))['maps']
    assert len(maps) == 12 and {m['id'] for m in maps} >= {'standard', 'new_shores'}


def test_create_and_start_game(server):
    async def run():
        client = socketio.AsyncClient()
        states = []
        client.on('gameState', lambda s: states.append(s))
        await client.connect(server, transports=['websocket'])
        await client.emit('createRoom', {
            'roomCode': 'CI01', 'username': 'Tester', 'gameMode': 'basic', 'hideBankCards': False,
            'balancedDice': False, 'victoryPointsLimit': 10, 'turnTimeoutLimit': 60, 'mapId': 'standard',
            'slots': [{'type': 'human', 'color': '#ef4444'}, {'type': 'bot_easy', 'color': '#3b82f6'},
                      {'type': 'bot_easy', 'color': '#10b981'}],
        })
        for _ in range(40):
            if states and states[-1]['gameState'] == 'lobby':
                break
            await asyncio.sleep(0.1)
        assert states[-1]['code'] == 'CI01'
        assert states[-1]['slots'][0]['username'] == 'Tester'
        await client.emit('startGame')
        for _ in range(40):
            if states[-1]['gameState'] in ('setup', 'playing'):
                break
            await asyncio.sleep(0.1)
        final = states[-1]
        await client.disconnect()
        return final

    state = asyncio.run(run())
    assert state['gameState'] in ('setup', 'playing')
    assert len(state['board']['hexes']) >= 19
    assert sum(1 for s in state['slots'] if s['type'].startswith('bot')) == 2
