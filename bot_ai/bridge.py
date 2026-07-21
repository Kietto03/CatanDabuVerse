"""
Bridge between the authoritative server `room` dict and the headless engine.

Only `room_to_state` lives here (it imports engine, not server — avoiding an
import cycle). The reverse direction (applying an engine action to the real
room) lives in server.py, where the authoritative mutation helpers already are.

Scope: mode `basic` only.
"""

import random

from . import engine as E

_DEV_MAP = {
    'Knight': 'knight',
    'Monopoly': 'monopoly',
    'Year of Plenty': 'yop',
    'Road Building': 'road_building',
}


def _active_slots(room):
    """Non-empty slots in ascending index order = engine player order."""
    return [s for s in room['slots'] if s.get('type') != 'empty' and s.get('username')]


def room_to_state(room, rng=None):
    """Snapshot the room (during a bot's build phase) into an engine State whose
    player-to-move is the current player. Returns (state, room_idx_to_eng)."""
    rng = rng or random.Random()
    active = _active_slots(room)
    n = len(active)
    room_idx_to_eng = {s['index']: i for i, s in enumerate(active)}

    board = E.Board(room['board'])

    s = E.State.__new__(E.State)
    s.board = board
    s.n = n
    s.vp_limit = room.get('victoryPointsLimit', 10)
    s.v_owner = [None] * board.n_vertices
    s.v_building = [None] * board.n_vertices
    for v in room['board']['vertices']:
        o = v['owner']
        if o is not None and o in room_idx_to_eng:
            s.v_owner[v['id']] = room_idx_to_eng[o]
            s.v_building[v['id']] = v['building']
    s.e_owner = {}
    for e in room['board']['edges']:
        o = e['owner']
        if o is not None and o in room_idx_to_eng and e.get('type') != 'ship':
            s.e_owner[e['id']] = room_idx_to_eng[o]

    # robber hex index
    rh = room.get('robberHex')
    s.robber = board.desert_hex
    if rh:
        for hi, h in enumerate(board.hexes):
            if h['q'] == rh['q'] and h['r'] == rh['r']:
                s.robber = hi
                break

    s.players = []
    for slot in active:
        res = {r: int(slot['resources'].get(r, 0)) for r in E.RES}
        dev, new_dev, vp_cards, = [], [], 0
        for c in slot.get('devCards', []):
            if c == 'Victory Point':
                vp_cards += 1
            elif c in _DEV_MAP:
                dev.append(_DEV_MAP[c])
        for c in slot.get('devCardsBoughtThisTurn', []):
            if c == 'Victory Point':
                vp_cards += 1
            elif c in _DEV_MAP:
                new_dev.append(_DEV_MAP[c])
        s.players.append({
            'res': res, 'dev': dev, 'new_dev': new_dev,
            'vp_cards': vp_cards, 'knights': int(slot.get('knightsPlayed', 0)),
        })

    # remaining dev deck (mapped + shuffled = determinized hidden info)
    deck = []
    for c in room.get('devCardsDeck', []):
        deck.append('vp' if c == 'Victory Point' else _DEV_MAP.get(c, 'knight'))
    rng.shuffle(deck)
    s.dev_deck = deck

    lh = room.get('longestRoadHolder')
    ah = room.get('largestArmyHolder')
    s.longest_holder = room_idx_to_eng.get(lh) if lh is not None else None
    s.army_holder = room_idx_to_eng.get(ah) if ah is not None else None
    s.winner = None

    cur_eng = room_idx_to_eng.get(room['currentPlayerIndex'], 0)
    s.turn = cur_eng               # play phase: current_player = turn % n
    s.phase = 'build'              # snapshot taken after the dice were rolled
    s.to_discard = {}
    s.last_settlement = None
    s.setup_index = 2 * n          # setup already complete
    s.roads_free = 0
    s.played_dev_this_turn = bool(active[cur_eng].get('devCardPlayedThisTurn', False))
    s.dice = None
    return s, room_idx_to_eng
