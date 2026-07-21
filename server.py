import os
import math
import random
import secrets
import sqlite3
import asyncio
import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import map_layouts
from bot_ai import bridge as _bot_bridge, mcts as _bot_mcts

# Initialize SQLite database
DB_FILE = "catan.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS match_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT,
            winner TEXT,
            victory_points INTEGER,
            game_mode TEXT,
            played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def save_match(room_code, winner, victory_points, game_mode):
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO match_history (room_code, winner, victory_points, game_mode)
            VALUES (?, ?, ?, ?)
        """, (room_code, winner, victory_points, game_mode))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving match history to SQLite: {e}")

init_db()

# Socket.IO & FastAPI setup
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# In-Memory Rooms Store
rooms = {}
SLOT_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#eab308', '#06b6d4', '#ec4899']


# Bot Names Lists
BOT_NAMES_EASY = ["DerpBot", "BillyBot", "SlowBot", "CalmBot", "KindBot"]
BOT_NAMES_MEDIUM = ["TradeBot", "BuildBot", "SmartBot", "SteadyBot", "LogicBot"]
BOT_NAMES_HARD = ["AlphaBoard", "GrandMaster", "CatanPro", "AggroBot", "DeepCatan"]
BOT_NAMES_MCTS = ["MctsMind", "TreeSearch", "DeepThink", "SimulaBot", "OracleAI"]

def get_bot_name(bot_type, used_names=None):
    if bot_type == 'bot_mcts':
        bot_list = BOT_NAMES_MCTS
    elif bot_type == 'bot_easy':
        bot_list = BOT_NAMES_EASY
    elif bot_type == 'bot_medium':
        bot_list = BOT_NAMES_MEDIUM
    else:
        bot_list = BOT_NAMES_HARD
    used_names = used_names or set()
    # Prefer a name not already taken (across all difficulties) to avoid collisions.
    candidates = [n for n in bot_list if (n + " [Bot]") not in used_names]
    if candidates:
        return random.choice(candidates) + " [Bot]"
    # All base names taken — disambiguate with a numeric suffix.
    base = random.choice(bot_list)
    suffix = 2
    while f"{base} {suffix} [Bot]" in used_names:
        suffix += 1
    return f"{base} {suffix} [Bot]"

# Board generation lives in rules.py (shared with bot_ai engine).
from rules import assign_hex_numbers, generate_board  # noqa: E402

def get_adjacent_vertices(v_id, edges):
    adj = []
    for e in edges:
        if e['v1'] == v_id:
            adj.append(e['v2'])
        elif e['v2'] == v_id:
            adj.append(e['v1'])
    return adj

def is_road_connection_valid(board, edge, player_idx):
    """A road may connect through an endpoint only if that endpoint holds the
    player's own building, OR it is empty and the player already has a road
    touching it. An opponent's settlement/city on the endpoint blocks the
    connection through that vertex (official Catan rule)."""
    vertices = board['vertices']
    edges = board['edges']
    for v in (edge['v1'], edge['v2']):
        v_owner = vertices[v]['owner']
        if v_owner == player_idx:
            return True  # your own settlement or city sits here
        if v_owner is not None:
            continue  # opponent building blocks routing through this vertex
        # Empty vertex: valid if one of your other roads touches it.
        # Ships do NOT connect to roads at an open vertex (Seafarers rule).
        for e in edges:
            if e['id'] != edge['id'] and e['owner'] == player_idx and e.get('type') != 'ship' and (e['v1'] == v or e['v2'] == v):
                return True
    return False

def is_ship_connection_valid(board, edge, player_idx):
    """A ship may connect through an endpoint only if that endpoint holds the
    player's own settlement/city (coastal), OR it is empty and the player has
    another ship touching it. Ships and roads only join at a settlement/city."""
    vertices = board['vertices']
    edges = board['edges']
    for v in (edge['v1'], edge['v2']):
        v_owner = vertices[v]['owner']
        if v_owner == player_idx:
            return True  # your coastal settlement or city
        if v_owner is not None:
            continue  # opponent building blocks this vertex
        for e in edges:
            if e['id'] != edge['id'] and e['owner'] == player_idx and e.get('type') == 'ship' and (e['v1'] == v or e['v2'] == v):
                return True
    return False

def _hex_at(room, q, r):
    return next((h for h in room['board']['hexes'] if h['q'] == q and h['r'] == r), None)

def _edge_touches_hex(room, edge, hexpos):
    if not hexpos:
        return False
    h = _hex_at(room, hexpos['q'], hexpos['r'])
    return bool(h and edge['id'] in h['edges'])

def is_open_road(board, edge):
    """A road with at least one free end (an endpoint with no building and no
    other road attached). Used by the Diplomat progress card."""
    if edge.get('type') != 'road' or edge['owner'] is None:
        return False
    vertices = board['vertices']
    edges = board['edges']
    for v in (edge['v1'], edge['v2']):
        if vertices[v]['owner'] is not None:
            continue
        other_road = any(e['id'] != edge['id'] and e['owner'] is not None and e.get('type') != 'ship'
                         and (e['v1'] == v or e['v2'] == v) for e in edges)
        if not other_road:
            return True
    return False

def is_ship_open_ended(board, edge, player_idx):
    """A ship can be moved only from the open end of a shipping route: an
    endpoint with no building and no other of the player's ships attached."""
    edges = board['edges']
    vertices = board['vertices']
    for v in (edge['v1'], edge['v2']):
        if vertices[v]['owner'] is not None:
            continue  # anchored by a building here
        other_ship = any(
            e['id'] != edge['id'] and e['owner'] == player_idx and e.get('type') == 'ship'
            and (e['v1'] == v or e['v2'] == v)
            for e in edges
        )
        if not other_ship:
            return True
    return False

def roll_dice_balanced(room):
    if 'diceDeck' not in room or not room['diceDeck']:
        distribution = [
            2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6,
            7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 9, 9, 9, 9,
            10, 10, 10, 11, 11, 12
        ]
        room['diceDeck'] = list(distribution)
        random.shuffle(room['diceDeck'])
    val = room['diceDeck'].pop()
    d1 = random.randint(1, 6)
    d2 = val - d1
    while d2 < 1 or d2 > 6:
        d1 = random.randint(1, 6)
        d2 = val - d1
    return d1, d2

def get_sanitized_room_state(room, recipient_socket_id=None):
    return {
        'code': room['code'],
        'gameState': room['gameState'],
        'gameMode': room['gameMode'],
        'hideBankCards': room['hideBankCards'],
        'balancedDice': room['balancedDice'],
        'victoryPointsLimit': room['victoryPointsLimit'],
        'barbarianStep': room['barbarianStep'],
        'currentPlayerIndex': room['currentPlayerIndex'],
        'setupStep': room['setupStep'],
        'setupSubStep': room['setupSubStep'],
        'lastSetupSettlement': room['lastSetupSettlement'],
        'diceRolled': room['diceRolled'],
        'lastDiceRoll': room['lastDiceRoll'],
        'board': room['board'],
        'winner': room['winner'],
        'gameLog': room['gameLog'],
        'slots': [
            {
                'index': s['index'],
                'type': s['type'],
                'color': s['color'],
                'username': s['username'],
                'id': s['id'],
                'resources': s['resources'],
                'victoryPoints': s['victoryPoints'],
                'knights': s['knights'],
                'disconnected': s['disconnected'],
                'devCards': s['devCards'] if s['id'] and s['id'] == recipient_socket_id else [],
                'devCardsBoughtThisTurn': s.get('devCardsBoughtThisTurn', []) if s['id'] and s['id'] == recipient_socket_id else [],
                'devCardsCount': len(s['devCards']) + len(s.get('devCardsBoughtThisTurn', [])) if s['devCards'] or s.get('devCardsBoughtThisTurn') else 0,
                'knightsPlayed': s.get('knightsPlayed', 0),
                'devCardPlayedThisTurn': s.get('devCardPlayedThisTurn', False),
                'longestRoadLength': s.get('longestRoadLength', 0),
                'ready': s.get('ready', False),
                # Cities & Knights (own commodities private; improvements/walls public)
                'commodities': s.get('commodities', {'coin': 0, 'cloth': 0, 'paper': 0}) if s['id'] and s['id'] == recipient_socket_id else {},
                'commoditiesCount': sum(s.get('commodities', {}).values()),
                'improvements': s.get('improvements', {'trade': 0, 'politics': 0, 'science': 0}),
                'cityWalls': s.get('cityWalls', 0),
                'metropolis': s.get('metropolis', []),
                'progressCards': s.get('progressCards', []) if s['id'] and s['id'] == recipient_socket_id else [],
                'progressCardsCount': len(s.get('progressCards', []))
            }
            for s in room['slots']
        ],
        'bank': room['bank'],
        'robberHex': room['robberHex'],
        'pirateHex': room.get('pirateHex'),
        'goldPending': room.get('goldPending', {}),
        'discardsPending': room['discardsPending'],
        'largestArmyHolder': room.get('largestArmyHolder'),
        'longestRoadHolder': room.get('longestRoadHolder'),
        'activeTrade': room.get('activeTrade'),
        'metropolisHolders': room.get('metropolisHolders', {'trade': None, 'politics': None, 'science': None}),
        'eventDie': room.get('eventDie'),
        'merchant': room.get('merchant')
    }

async def broadcast_game_state(room):
    room_code = room['code']
    for slot in room['slots']:
        if slot['type'] == 'human' and slot['id'] and not slot['disconnected']:
            state = get_sanitized_room_state(room, slot['id'])
            await sio.emit('gameState', state, to=slot['id'])

def advance_turn(room):
    idx = room['currentPlayerIndex']
    ending_player = room['slots'][idx]
    if ending_player and ending_player['type'] != 'empty':
        # Merge devCardsBoughtThisTurn into devCards at the end of the turn
        bought = ending_player.get('devCardsBoughtThisTurn', [])
        if bought:
            ending_player['devCards'].extend(bought)
            ending_player['devCardsBoughtThisTurn'] = []
        ending_player['devCardPlayedThisTurn'] = False
        # Cities & Knights: one-turn progress-card effects expire.
        ending_player['craneDiscount'] = False
        ending_player['medicineDiscount'] = False
        ending_player['merchantFleet'] = None

    # Clean up any unresolved road building state if turn was ended
    if 'roadBuildingState' in room:
        room['roadBuildingState'] = None
    if 'roadBuildingReturnState' in room:
        room['roadBuildingReturnState'] = None
    if 'activeTrade' in room:
        room['activeTrade'] = None
    room['forcedDice'] = None
    room['bishopActive'] = False

    # Seafarers: ships placed last turn become movable; reset the per-turn move.
    room['shipMovedThisTurn'] = False
    for e in room['board']['edges']:
        if e.get('builtThisTurn'):
            e['builtThisTurn'] = False

    # Cities & Knights: knights built/acted last turn are free to act again.
    for v in room['board']['vertices']:
        k = v.get('knight')
        if k:
            k['builtThisTurn'] = False
            k['actedThisTurn'] = False

    while True:
        idx = (idx + 1) % len(room['slots'])
        if room['slots'][idx]['type'] != 'empty':
            break
    room['currentPlayerIndex'] = idx
    room['diceRolled'] = False

def distribute_resources(room, roll):
    dues = {
        'wood': {},
        'brick': {},
        'sheep': {},
        'wheat': {},
        'ore': {}
    }

    gold_dues = {}  # player_idx -> number of any-resource picks (Seafarers gold field)
    # Cities & Knights: cities on ore/wood/sheep also yield a commodity.
    is_cities = room.get('gameMode') == 'cities'
    COMMODITY_OF = {'ore': 'coin', 'wood': 'paper', 'sheep': 'cloth'}
    commodity_dues = {'coin': {}, 'cloth': {}, 'paper': {}}

    # Find all distributions due
    for hex_tile in room['board']['hexes']:
        if hex_tile['number'] == roll and hex_tile['resource'] not in ['desert', 'water']:
            # Check if robber blocks this hex
            if room['robberHex'] and room['robberHex']['q'] == hex_tile['q'] and room['robberHex']['r'] == hex_tile['r']:
                room['gameLog'].append(f"The Robber blocks resource collection on the {hex_tile['resource']} hex.")
                continue
            for v_id in hex_tile['vertices']:
                v = room['board']['vertices'][v_id]
                if v['owner'] is not None:
                    slot = room['slots'][v['owner']]
                    if slot and slot['type'] != 'empty':
                        res = hex_tile['resource']
                        is_city = v['building'] == 'city'
                        if res == 'gold':
                            gold_dues[slot['index']] = gold_dues.get(slot['index'], 0) + (2 if is_city else 1)
                        elif is_cities and is_city and res in COMMODITY_OF:
                            # C&K city on a commodity terrain: 1 resource + 1 commodity
                            dues[res][slot['index']] = dues[res].get(slot['index'], 0) + 1
                            com = COMMODITY_OF[res]
                            commodity_dues[com][slot['index']] = commodity_dues[com].get(slot['index'], 0) + 1
                        else:
                            yield_amt = 2 if is_city else 1
                            dues[res][slot['index']] = dues[res].get(slot['index'], 0) + yield_amt

    room['goldPending'] = gold_dues

    # Track who actually collected anything this roll (for the Aqueduct ability).
    received_idx = set(gold_dues.keys())

    # Hand out commodities (unlimited supply, kept simple).
    for com in ['coin', 'cloth', 'paper']:
        for idx, amt in commodity_dues[com].items():
            slot = room['slots'][idx]
            slot['commodities'][com] = slot['commodities'].get(com, 0) + amt
            received_idx.add(idx)
            room['gameLog'].append(f"{slot['username']} collected {amt} {com}.")

    distributions_log = {}

    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        player_dues = dues[res]
        player_indices = list(player_dues.keys())
        if not player_indices:
            continue

        total_due = sum(player_dues[idx] for idx in player_indices)
        eligible_players_count = len(player_indices)
        bank_stock = room['bank'].get(res, 0) if room['bank'] else 19

        if total_due <= bank_stock:
            for idx in player_indices:
                amt = player_dues[idx]
                slot = room['slots'][idx]
                slot['resources'][res] = slot['resources'].get(res, 0) + amt
                if room['bank']:
                    room['bank'][res] -= amt
                received_idx.add(idx)

                if slot['username'] not in distributions_log:
                    distributions_log[slot['username']] = {}
                distributions_log[slot['username']][res] = distributions_log[slot['username']].get(res, 0) + amt
        else:
            if eligible_players_count == 1:
                idx = player_indices[0]
                slot = room['slots'][idx]
                given = bank_stock
                if given > 0:
                    slot['resources'][res] = slot['resources'].get(res, 0) + given
                    if room['bank']:
                        room['bank'][res] = 0
                    received_idx.add(idx)
                    if slot['username'] not in distributions_log:
                        distributions_log[slot['username']] = {}
                    distributions_log[slot['username']][res] = distributions_log[slot['username']].get(res, 0) + given
                    room['gameLog'].append(f"Bank is low on {res}! {slot['username']} received only {given} {res}.")
                else:
                    room['gameLog'].append(f"Bank is out of {res}! {slot['username']} received 0 {res}.")
            else:
                room['gameLog'].append(f"Bank has insufficient {res} ({bank_stock} left, {total_due} needed) to pay all eligible players. No one receives {res} this turn.")

    if distributions_log:
        for username, res_map in distributions_log.items():
            summary = ", ".join(f"{count} {res}" for res, count in res_map.items())
            room['gameLog'].append(f"{username} collected: {summary}.")
    else:
        any_commodity = any(commodity_dues[c] for c in commodity_dues)
        if not gold_dues and not any_commodity:
            last_log = room['gameLog'][-1] if room['gameLog'] else ""
            if "insufficient" not in last_log and "out of" not in last_log and "low on" not in last_log:
                room['gameLog'].append('No resources collected.')

    # Cities & Knights — Aqueduct (Science improvement level 3): a player who
    # produced nothing on this roll may take any 1 resource of their choice.
    # Resolved through the same "choose a resource" flow as Seafarers gold.
    if is_cities:
        for slot in room['slots']:
            if slot['type'] == 'empty':
                continue
            if slot.get('improvements', {}).get('science', 0) >= 3 and slot['index'] not in received_idx:
                room['goldPending'][slot['index']] = room['goldPending'].get(slot['index'], 0) + 1
                room['gameLog'].append(f"{slot['username']}'s Aqueduct: no production this roll — take 1 resource of choice.")


# ----------------------------------------------------
# Seafarers: gold field resolution
# ----------------------------------------------------
def _auto_pick_gold(room, idx):
    """Auto-resolve a gold field for a bot or a timed-out player: take the
    resources the player currently has the least of (that the bank still has)."""
    slot = room['slots'][idx]
    count = room['goldPending'].get(idx, 0)
    picked = 0
    for _ in range(count):
        choices = [r for r in ['wood', 'brick', 'sheep', 'wheat', 'ore'] if not room['bank'] or room['bank'].get(r, 0) > 0]
        if not choices:
            break
        pick = min(choices, key=lambda r: slot['resources'].get(r, 0))
        slot['resources'][pick] = slot['resources'].get(pick, 0) + 1
        if room['bank']:
            room['bank'][pick] -= 1
        picked += 1
    room['goldPending'].pop(idx, None)
    if picked:
        room['gameLog'].append(f"{slot['username']} received {picked} resource(s) from a Gold field.")


def resolve_gold_after_roll(room):
    """Auto-resolve bots' gold immediately. Returns True if any human still
    needs to choose (caller should enter the 'goldChoice' state)."""
    pending = room.get('goldPending', {})
    if not pending:
        return False
    for idx in list(pending.keys()):
        slot = room['slots'][idx]
        if slot['type'].startswith('bot'):
            _auto_pick_gold(room, idx)
    return bool(room['goldPending'])


# ----------------------------------------------------
# Seafarers: island discovery bonus
# ----------------------------------------------------
def award_island_vp(room, vertex_id, player):
    """+2 VP the first time a player settles on a non-main island (Seafarers).
    Only counts for settlements founded during play — initial setup placements
    do not earn the bonus, otherwise a player could grab it for free without
    ever sailing a ship there."""
    if room.get('gameMode') != 'seafarers':
        return
    if room.get('gameState') == 'setup':
        return
    board = room['board']
    main_island = board.get('mainIsland')
    for h in board['hexes']:
        if h['resource'] == 'water':
            continue
        isl = h.get('island')
        if isl is None or isl == main_island:
            continue
        if vertex_id in h['vertices'] and isl not in room['discoveredIslands']:
            room['discoveredIslands'].add(isl)
            player['victoryPoints'] += 2
            room['gameLog'].append(f"{player['username']} founded a settlement on a new island (+2 Victory Points)!")


# ----------------------------------------------------
# Cities & Knights shared helpers
# ----------------------------------------------------
IMPROVEMENT_COMMODITY = {'trade': 'cloth', 'politics': 'coin', 'science': 'paper'}

def hand_size(slot):
    """Total cards held: resources + commodities (commodities are 0 outside C&K)."""
    return sum(slot['resources'].values()) + sum(slot.get('commodities', {}).values())

def discard_limit(slot):
    """Hand limit before a 7 forces a discard. Each City Wall adds 2 (C&K)."""
    return 7 + 2 * slot.get('cityWalls', 0)

def discard_random_cards(room, slot, count):
    """Discard `count` random cards from a player's hand (resources + commodities).
    Returns how many were actually discarded."""
    hand = []
    for res, q in slot['resources'].items():
        hand.extend([('r', res)] * q)
    for com, q in slot.get('commodities', {}).items():
        hand.extend([('c', com)] * q)
    random.shuffle(hand)
    chosen = hand[:count]
    for kind, name in chosen:
        if kind == 'r':
            slot['resources'][name] -= 1
            if room['bank']:
                room['bank'][name] = min(19, room['bank'][name] + 1)
        else:
            slot['commodities'][name] -= 1
    return len(chosen)


# ----------------------------------------------------
# Cities & Knights — real Knights (occupy intersections, tracked on the vertex
# as v['knight'] = {'owner','level','active','builtThisTurn','actedThisTurn'} so
# they never interfere with settlement/city ownership, production, robber or roads.
# ----------------------------------------------------
KNIGHT_MAX_TOTAL = 6      # 2 basic + 2 strong + 2 mighty
KNIGHT_MAX_PER_LEVEL = 2

def player_knights(room, player_idx):
    return [v for v in room['board']['vertices'] if v.get('knight') and v['knight']['owner'] == player_idx]

def knight_strength(room, player_idx):
    """Total level of a player's ACTIVE knights (their barbarian-defense power)."""
    return sum(v['knight']['level'] for v in player_knights(room, player_idx) if v['knight']['active'])

def vertex_is_free(vertex):
    """A vertex with no building and no knight can host a new settlement or knight."""
    return vertex['owner'] is None and vertex.get('knight') is None

def vertex_touches_land(board, vertex_id):
    """A settlement/city must sit on the coast or inland — at least one of the
    hexes meeting at this vertex must be a land hex (not open sea). On classic
    boards every hex is land, so this is always true there."""
    for h in board['hexes']:
        if h['resource'] != 'water' and vertex_id in h['vertices']:
            return True
    return False

def vertex_road_connected(board, vertex_id, player_idx):
    return any((e['v1'] == vertex_id or e['v2'] == vertex_id) and e['owner'] == player_idx for e in board['edges'])

def knight_reachable_vertices(board, from_v, player_idx):
    """Vertices reachable from `from_v` along the player's own road/ship network.
    Movement passes through empty and own-occupied vertices but stops at (though
    can still land on) a vertex held by an opponent building or knight."""
    edges = board['edges']
    vertices = board['vertices']
    adj = {}
    for e in edges:
        if e['owner'] == player_idx:
            adj.setdefault(e['v1'], []).append(e['v2'])
            adj.setdefault(e['v2'], []).append(e['v1'])
    seen = {from_v}
    frontier = [from_v]
    reachable = set()
    while frontier:
        cur = frontier.pop()
        for nb in adj.get(cur, []):
            if nb in seen:
                continue
            seen.add(nb)
            reachable.add(nb)
            v = vertices[nb]
            blocked_building = v['owner'] is not None and v['owner'] != player_idx
            k = v.get('knight')
            blocked_knight = k is not None and k['owner'] != player_idx
            if not blocked_building and not blocked_knight:
                frontier.append(nb)  # can continue routing past an empty/own vertex
    return reachable


# The event die: 3 barbarian faces + one gate per discipline.
EVENT_DIE_FACES = ['ship', 'ship', 'ship', 'trade', 'politics', 'science']

# Progress-card decks (official Cities & Knights distribution).
PROGRESS_DECK_DEFS = {
    'trade': (['Commercial Harbor'] * 2 + ['Master Merchant'] * 2 + ['Merchant'] * 6 +
              ['Merchant Fleet'] * 2 + ['Resource Monopoly'] * 4 + ['Trade Monopoly'] * 2),
    'politics': (['Bishop'] * 2 + ['Constitution'] * 1 + ['Deserter'] * 2 + ['Diplomat'] * 2 +
                 ['Intrigue'] * 2 + ['Saboteur'] * 2 + ['Spy'] * 3 + ['Warlord'] * 2 + ['Wedding'] * 2),
    'science': (['Alchemist'] * 2 + ['Crane'] * 2 + ['Engineer'] * 1 + ['Inventor'] * 2 +
                ['Irrigation'] * 2 + ['Medicine'] * 2 + ['Mining'] * 2 + ['Printer'] * 1 +
                ['Road Building'] * 2 + ['Smith'] * 2),
}
PROGRESS_VP_CARDS = {'Constitution', 'Printer'}       # auto-resolved on draw (+1 VP)
PROGRESS_HAND_LIMIT = 4

def build_progress_decks():
    decks = {}
    for track, cards in PROGRESS_DECK_DEFS.items():
        deck = list(cards)
        random.shuffle(deck)
        decks[track] = deck
    return decks

def resolve_event_die(room, red_die=0):
    """Cities & Knights: roll the event die each turn. A ship face advances the
    barbarians (attack at 7); a colored gate lets every player whose matching
    city-improvement level >= the red die draw a progress card."""
    if room.get('gameMode') != 'cities':
        return
    face = random.choice(EVENT_DIE_FACES)
    room['eventDie'] = face
    if face == 'ship':
        room['barbarianStep'] = room.get('barbarianStep', 0) + 1
        if room['barbarianStep'] >= 7:
            resolve_barbarian_attack_ck(room)
            room['barbarianStep'] = 0
        else:
            room['gameLog'].append(f"Barbarians advance toward Catan ({room['barbarianStep']}/7).")
    else:
        _draw_progress_cards(room, face, red_die)

def _grant_progress_card(room, slot, track):
    """Draw the top card of a track's progress deck for one player, honouring VP
    cards and the hand limit. Returns True if a card (or VP) was granted."""
    deck = room.get('progressDecks', {}).get(track)
    if not deck:
        return False
    card = deck.pop()
    if card in PROGRESS_VP_CARDS:
        slot['victoryPoints'] += 1
        room['gameLog'].append(f"{slot['username']} drew {card} from the {track.capitalize()} deck (+1 Victory Point)!")
        check_victory(room, slot)
        return True
    slot.setdefault('progressCards', []).append(card)
    room['gameLog'].append(f"{slot['username']} drew a {track.capitalize()} progress card.")
    # Hand limit: keep the newest, return the oldest excess to the bottom of the deck.
    while len(slot['progressCards']) > PROGRESS_HAND_LIMIT:
        dropped = slot['progressCards'].pop(0)
        deck.insert(0, dropped)
        room['gameLog'].append(f"{slot['username']} discarded a progress card (limit {PROGRESS_HAND_LIMIT}).")
    return True


def _draw_progress_cards(room, track, red_die):
    deck = room.get('progressDecks', {}).get(track)
    drawers = [s for s in room['slots']
               if s['type'] != 'empty' and s.get('improvements', {}).get(track, 0) >= red_die]
    if not deck or red_die < 1 or not drawers:
        room['gameLog'].append(f"The {track.capitalize()} gate opens (red die {red_die}) — no one qualifies.")
        return
    for s in drawers:
        if not deck:
            break
        _grant_progress_card(room, s, track)

def resolve_barbarian_attack_ck(room):
    """Cities & Knights barbarian attack: cities are the target, active knight
    strength is the defense. Strongest army defends (+1 VP); if the knights are
    too weak the least-defended city owner(s) lose a city. Then all knights rest."""
    attack = sum(1 for v in room['board']['vertices'] if v['building'] == 'city')
    contributions = {s['index']: knight_strength(room, s['index'])
                     for s in room['slots'] if s['type'] != 'empty'}
    defense = sum(contributions.values())
    room['gameLog'].append(f"⚔️ The Barbarians reach Catan! Attack strength {attack} vs Knight defense {defense}.")

    if defense >= attack:
        max_c = max(contributions.values()) if contributions else 0
        if max_c > 0:
            winners = [idx for idx, c in contributions.items() if c == max_c]
            if len(winners) == 1:
                w = room['slots'][winners[0]]
                w['victoryPoints'] += 1
                room['gameLog'].append(f"🛡️ {w['username']} defended Catan and is the Defender of Catan (+1 Victory Point)!")
                check_victory(room, w)
            else:
                # Official rule: on a tie for the strongest army, no Defender VP
                # is awarded — instead each tied player draws one progress card.
                names = ", ".join(room['slots'][i]['username'] for i in winners)
                room['gameLog'].append(f"🛡️ Catan is defended! {names} tied for the strongest army — each draws a progress card.")
                for i in winners:
                    s = room['slots'][i]
                    imp = s.get('improvements', {})
                    # Draw from the player's strongest improvement track (a card
                    # they can most benefit from), preferring trade > politics > science.
                    track = max(('trade', 'politics', 'science'), key=lambda t: imp.get(t, 0))
                    _grant_progress_card(room, s, track)
        else:
            room['gameLog'].append("🛡️ Catan is defended.")
    else:
        # Weakest contributor(s) that own a reducible city each lose one city.
        city_owners = {}
        for s in room['slots']:
            if s['type'] == 'empty':
                continue
            has_city = any(v['building'] == 'city' and v['owner'] == s['index'] and not v.get('metropolis')
                           for v in room['board']['vertices'])
            if has_city:
                city_owners[s['index']] = contributions.get(s['index'], 0)
        if city_owners:
            weakest = min(city_owners.values())
            losers = [idx for idx, c in city_owners.items() if c == weakest]
            for idx in losers:
                city_v = next((v for v in room['board']['vertices']
                               if v['building'] == 'city' and v['owner'] == idx and not v.get('metropolis')), None)
                if city_v:
                    city_v['building'] = 'settlement'
                    room['slots'][idx]['victoryPoints'] = max(0, room['slots'][idx]['victoryPoints'] - 1)
                    room['gameLog'].append(f"🔥 {room['slots'][idx]['username']} was pillaged — a city was razed back to a settlement!")
        else:
            room['gameLog'].append("🔥 The Barbarians pillage, but find no reducible cities.")

    # All knights are exhausted (deactivated) after the battle.
    for v in room['board']['vertices']:
        if v.get('knight'):
            v['knight']['active'] = False


# Bot Helpers
def has_resources_for_settlement(slot):
    r = slot['resources']
    return r.get('wood', 0) >= 1 and r.get('brick', 0) >= 1 and r.get('sheep', 0) >= 1 and r.get('wheat', 0) >= 1

def has_resources_for_road(slot):
    r = slot['resources']
    return r.get('wood', 0) >= 1 and r.get('brick', 0) >= 1

def bot_trade_if_needed(room, slot):
    r = slot['resources']
    needs = ['wood', 'brick', 'sheep', 'wheat']
    missing = [res for res in needs if r.get(res, 0) < 1]
    if len(missing) == 1:
        target = missing[0]
        if room['bank'] and room['bank'].get(target, 0) >= 1:
            for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
                if res != target and r.get(res, 0) >= 4:
                    r[res] -= 4
                    r[target] = r.get(target, 0) + 1
                    room['bank'][res] = min(19, room['bank'][res] + 4)
                    room['bank'][target] -= 1
                    room['gameLog'].append(f"{slot['username']} traded 4 {res} for 1 {target} with the Bank.")
                    return

    road_needs = ['wood', 'brick']
    road_missing = [res for res in road_needs if r.get(res, 0) < 1]
    if len(road_missing) == 1:
        target = road_missing[0]
        if room['bank'] and room['bank'].get(target, 0) >= 1:
            for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
                if res != target and r.get(res, 0) >= 4:
                    r[res] -= 4
                    r[target] = r.get(target, 0) + 1
                    room['bank'][res] = min(19, room['bank'][res] + 4)
                    room['bank'][target] -= 1
                    room['gameLog'].append(f"{slot['username']} traded 4 {res} for 1 {target} with the Bank.")
                    return

# ----------------------------------------------------
# Bot build AI (difficulty-aware, mode-aware)
# ----------------------------------------------------
NUMBER_PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 0, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}

def _bot_difficulty(slot):
    t = slot.get('type', '')
    if t in ('bot_hard', 'bot_mcts'):
        return 'hard'  # bot_mcts uses the hard heuristic when it falls back
    if t == 'bot_medium':
        return 'medium'
    return 'easy'

def _bot_vertex_score(room, vid):
    """Quality of an intersection = sum of adjacent hex pips + resource diversity."""
    score = 0
    res_seen = set()
    for h in room['board']['hexes']:
        if vid in h['vertices'] and h['resource'] not in ('water', 'desert'):
            score += NUMBER_PIPS.get(h.get('number') or 0, 0)
            res_seen.add(h['resource'])
    return score + len(res_seen)

def _bot_settlement_spots(room, idx):
    spots = []
    for v in room['board']['vertices']:
        if v['owner'] is None and v.get('knight') is None and vertex_touches_land(room['board'], v['id']):
            adj = get_adjacent_vertices(v['id'], room['board']['edges'])
            if any(room['board']['vertices'][a]['owner'] is not None for a in adj):
                continue
            if any((e['v1'] == v['id'] or e['v2'] == v['id']) and e['owner'] == idx for e in room['board']['edges']):
                spots.append(v['id'])
    return spots

def _bot_pick(options, diff, key):
    """Pick from options: easy random, hard best, medium best-half."""
    if not options:
        return None
    if diff == 'easy':
        return random.choice(options)
    ranked = sorted(options, key=key, reverse=True)
    if diff == 'medium':
        return random.choice(ranked[:max(1, len(ranked) // 2)])
    return ranked[0]

def _bank_ret(room, res, n):
    if room['bank']:
        room['bank'][res] = min(19, room['bank'][res] + n)

def _bot_win_check(room, slot):
    if slot['victoryPoints'] >= room['victoryPointsLimit'] and room['gameState'] != 'gameover':
        room['gameState'] = 'gameover'
        room['winner'] = slot['username']
        room['gameLog'].append(f"{slot['username']} reaches {room['victoryPointsLimit']} Victory Points and wins!")
        save_match(room['code'], slot['username'], slot['victoryPoints'], room['gameMode'])

def do_bot_build_phase(room, slot):
    """Drive a bot's whole build phase: repeatedly take the best affordable
    action until nothing useful remains. Returns whether anything was built."""
    idx = slot['index']
    diff = _bot_difficulty(slot)
    mode = room['gameMode']
    r = slot['resources']
    built = False

    # Defensive: activate all knights with Warlord when the barbarians loom.
    if mode == 'cities' and 'Warlord' in slot.get('progressCards', []) and room.get('barbarianStep', 0) >= 4:
        for v in player_knights(room, idx):
            v['knight']['active'] = True
        slot['progressCards'].remove('Warlord')
        room['gameLog'].append(f"{slot['username']} played Warlord and activated all knights.")
        built = True

    for _ in range(15):
        if room['gameState'] != 'playing':
            break
        acted = False
        cities = [v for v in room['board']['vertices'] if v['owner'] == idx and v['building'] == 'city']
        setts = [v for v in room['board']['vertices'] if v['owner'] == idx and v['building'] == 'settlement']

        # 1) Upgrade a settlement to a city
        if not acted and setts and len(cities) < 4 and r.get('ore', 0) >= 3 and r.get('wheat', 0) >= 2:
            tid = _bot_pick([v['id'] for v in setts], diff, lambda vid: _bot_vertex_score(room, vid))
            v = room['board']['vertices'][tid]
            r['ore'] -= 3; r['wheat'] -= 2; _bank_ret(room, 'ore', 3); _bank_ret(room, 'wheat', 2)
            v['building'] = 'city'; slot['victoryPoints'] += 1
            room['gameLog'].append(f"{slot['username']} upgraded a settlement to a City.")
            _bot_win_check(room, slot)
            acted = True

        # 2) Cities & Knights: advance a city improvement toward a metropolis
        if not acted and mode == 'cities' and cities and diff != 'easy':
            for track in ('science', 'trade', 'politics'):
                lvl = slot['improvements'][track]
                com = IMPROVEMENT_COMMODITY[track]
                if lvl < 5 and slot['commodities'].get(com, 0) >= lvl + 1:
                    slot['commodities'][com] -= (lvl + 1)
                    slot['improvements'][track] = lvl + 1
                    room['gameLog'].append(f"{slot['username']} advanced {track.capitalize()} to level {lvl + 1}.")
                    award_metropolis(room, slot, track)
                    _bot_win_check(room, slot)
                    acted = True
                    break

        # 3) Cities & Knights: recruit knights for defense
        if not acted and mode == 'cities' and r.get('ore', 0) >= 1 and r.get('sheep', 0) >= 1:
            target = 1 if diff == 'easy' else (2 if diff == 'medium' else 3)
            if len(player_knights(room, idx)) < target:
                spot = next((v['id'] for v in room['board']['vertices']
                             if vertex_is_free(v) and vertex_road_connected(room['board'], v['id'], idx)), None)
                if spot is not None:
                    r['ore'] -= 1; r['sheep'] -= 1; _bank_ret(room, 'ore', 1); _bank_ret(room, 'sheep', 1)
                    room['board']['vertices'][spot]['knight'] = {'owner': idx, 'level': 1, 'active': False, 'builtThisTurn': True, 'actedThisTurn': False}
                    room['gameLog'].append(f"{slot['username']} recruited a Knight.")
                    acted = True

        # 4) Cities & Knights: activate a knight when barbarians approach
        if not acted and mode == 'cities' and r.get('wheat', 0) >= 1 and (room.get('barbarianStep', 0) >= 3 or diff == 'hard'):
            kv = next((v for v in player_knights(room, idx) if not v['knight']['active'] and not v['knight'].get('builtThisTurn')), None)
            if kv:
                r['wheat'] -= 1; _bank_ret(room, 'wheat', 1); kv['knight']['active'] = True
                room['gameLog'].append(f"{slot['username']} activated a Knight.")
                acted = True

        # 5) Build a settlement
        if not acted and has_resources_for_settlement(slot) and len(setts) < 5:
            spot = _bot_pick(_bot_settlement_spots(room, idx), diff, lambda vid: _bot_vertex_score(room, vid))
            if spot is not None:
                for res in ('wood', 'brick', 'wheat', 'sheep'):
                    r[res] -= 1; _bank_ret(room, res, 1)
                v = room['board']['vertices'][spot]; v['owner'] = idx; v['building'] = 'settlement'
                slot['victoryPoints'] += 1
                award_island_vp(room, spot, slot)
                room['gameLog'].append(f"{slot['username']} built a settlement.")
                check_longest_road(room); check_road_victory(room); _bot_win_check(room, slot)
                acted = True

        # 6) Seafarers: build a ship to expand across the water
        if not acted and mode == 'seafarers' and r.get('wood', 0) >= 1 and r.get('sheep', 0) >= 1:
            if len([e for e in room['board']['edges'] if e['owner'] == idx and e.get('type') == 'ship']) < 15:
                cands = [e for e in room['board']['edges']
                         if e['owner'] is None and e.get('sea') and is_ship_connection_valid(room['board'], e, idx)
                         and not (room.get('pirateHex') and _edge_touches_hex(room, e, room['pirateHex']))]
                if cands:
                    def ship_score(eid):
                        e = next(x for x in cands if x['id'] == eid)
                        return max(_bot_vertex_score(room, e['v1']), _bot_vertex_score(room, e['v2']))
                    eid = _bot_pick([e['id'] for e in cands], diff, ship_score)
                    edge = next(e for e in cands if e['id'] == eid)
                    r['wood'] -= 1; r['sheep'] -= 1; _bank_ret(room, 'wood', 1); _bank_ret(room, 'sheep', 1)
                    edge['owner'] = idx; edge['type'] = 'ship'; edge['builtThisTurn'] = True
                    room['gameLog'].append(f"{slot['username']} built a ship.")
                    check_longest_road(room); check_road_victory(room)
                    acted = True

        # 8) Build a road toward the best open intersection
        if not acted and has_resources_for_road(slot):
            if len([e for e in room['board']['edges'] if e['owner'] == idx and e.get('type') != 'ship']) < 15:
                cands = [e for e in room['board']['edges']
                         if e['owner'] is None and (mode != 'seafarers' or e.get('land'))
                         and is_road_connection_valid(room['board'], e, idx)]
                if cands:
                    def road_score(eid):
                        e = next(x for x in cands if x['id'] == eid)
                        best = 0
                        for vv in (e['v1'], e['v2']):
                            if room['board']['vertices'][vv]['owner'] is None:
                                best = max(best, _bot_vertex_score(room, vv))
                        return best
                    eid = _bot_pick([e['id'] for e in cands], diff, road_score)
                    edge = next(e for e in cands if e['id'] == eid)
                    r['wood'] -= 1; r['brick'] -= 1; _bank_ret(room, 'wood', 1); _bank_ret(room, 'brick', 1)
                    edge['owner'] = idx; edge['type'] = 'road'
                    room['gameLog'].append(f"{slot['username']} built a road.")
                    check_longest_road(room); check_road_victory(room)
                    acted = True

        # 9) Cities & Knights: build a City Wall when holding lots of cards
        if not acted and mode == 'cities' and diff != 'easy' and r.get('brick', 0) >= 2:
            if slot.get('cityWalls', 0) < min(3, len(cities)) and hand_size(slot) > 7:
                r['brick'] -= 2; _bank_ret(room, 'brick', 2); slot['cityWalls'] = slot.get('cityWalls', 0) + 1
                room['gameLog'].append(f"{slot['username']} built a City Wall (hand limit +2).")
                acted = True

        # 10) Non-cities: occasionally buy a development card
        if not acted and mode != 'cities' and diff != 'easy' and room.get('devCardsDeck') \
                and r.get('ore', 0) >= 1 and r.get('wheat', 0) >= 1 and r.get('sheep', 0) >= 1 \
                and random.random() < (0.5 if diff == 'hard' else 0.3):
            r['ore'] -= 1; r['wheat'] -= 1; r['sheep'] -= 1
            _bank_ret(room, 'ore', 1); _bank_ret(room, 'wheat', 1); _bank_ret(room, 'sheep', 1)
            card = room['devCardsDeck'].pop()
            if card == 'Victory Point':
                slot['devCards'].append(card)
            else:
                slot.setdefault('devCardsBoughtThisTurn', []).append(card)
            room['gameLog'].append(f"{slot['username']} bought a Development Card.")
            check_victory(room, slot)
            acted = True

        if acted:
            built = True
            bot_trade_if_needed(room, slot)
        else:
            break

    return built


# ---------------------------------------------------------------------------
# MCTS bot (mode `basic`): the headless engine + MCTS decide *which* build
# action to take; the authoritative server executes it here. Only economic
# build actions are driven by MCTS in this first version — dev-card play and the
# robber still use the heuristic path. Any error falls back to the heuristic.
# ---------------------------------------------------------------------------
MCTS_TIME_BUDGET_MS = 350
MCTS_MAX_SIMS = 150   # ~93% win vs heuristic in self-play; keeps live turns snappy

def apply_mcts_action(room, slot, action):
    """Execute an engine action against the real room. Returns True if applied."""
    idx = slot['index']
    r = slot['resources']
    kind = action[0]

    if kind == 'build_settlement':
        vid = action[1]
        v = room['board']['vertices'][vid]
        if v['owner'] is not None:
            return False
        if any(r.get(x, 0) < 1 for x in ('wood', 'brick', 'wheat', 'sheep')):
            return False
        for res in ('wood', 'brick', 'wheat', 'sheep'):
            r[res] -= 1; _bank_ret(room, res, 1)
        v['owner'] = idx; v['building'] = 'settlement'; slot['victoryPoints'] += 1
        award_island_vp(room, vid, slot)
        room['gameLog'].append(f"{slot['username']} built a settlement.")
        check_longest_road(room); check_road_victory(room); check_victory(room, slot)
        return True

    if kind == 'build_city':
        vid = action[1]
        v = room['board']['vertices'][vid]
        if v['owner'] != idx or v['building'] != 'settlement':
            return False
        if r.get('ore', 0) < 3 or r.get('wheat', 0) < 2:
            return False
        r['ore'] -= 3; r['wheat'] -= 2; _bank_ret(room, 'ore', 3); _bank_ret(room, 'wheat', 2)
        v['building'] = 'city'; slot['victoryPoints'] += 1
        room['gameLog'].append(f"{slot['username']} upgraded a settlement to a City.")
        check_victory(room, slot)
        return True

    if kind == 'build_road':
        eid = action[1]
        edge = next((e for e in room['board']['edges'] if e['id'] == eid), None)
        if not edge or edge['owner'] is not None or not edge.get('land'):
            return False
        if r.get('wood', 0) < 1 or r.get('brick', 0) < 1:
            return False
        r['wood'] -= 1; r['brick'] -= 1; _bank_ret(room, 'wood', 1); _bank_ret(room, 'brick', 1)
        edge['owner'] = idx; edge['type'] = 'road'
        room['gameLog'].append(f"{slot['username']} built a road.")
        check_longest_road(room); check_road_victory(room)
        return True

    if kind == 'buy_dev':
        if not room.get('devCardsDeck'):
            return False
        if r.get('ore', 0) < 1 or r.get('wheat', 0) < 1 or r.get('sheep', 0) < 1:
            return False
        r['ore'] -= 1; r['wheat'] -= 1; r['sheep'] -= 1
        _bank_ret(room, 'ore', 1); _bank_ret(room, 'wheat', 1); _bank_ret(room, 'sheep', 1)
        card = room['devCardsDeck'].pop()
        if card == 'Victory Point':
            slot['devCards'].append(card)
        else:
            slot.setdefault('devCardsBoughtThisTurn', []).append(card)
        room['gameLog'].append(f"{slot['username']} bought a Development Card.")
        check_victory(room, slot)
        return True

    if kind == 'bank_trade':
        give, get = action[1], action[2]
        ratios = get_player_trade_ratios(room, idx)
        need = ratios.get(give, 4)
        if r.get(give, 0) < need:
            return False
        r[give] -= need; r[get] = r.get(get, 0) + 1
        if room.get('bank'):
            room['bank'][give] = min(19, room['bank'].get(give, 0) + need)
            room['bank'][get] = max(0, room['bank'].get(get, 0) - 1)
        room['gameLog'].append(f"{slot['username']} traded {need} {give} for 1 {get} with the bank.")
        return True

    return False  # play_dev / move_robber / end_turn -> stop MCTS loop


def mcts_build_phase(room, slot):
    """Drive a bot's build phase with MCTS. Returns True on success, False to
    signal the caller to fall back to the heuristic."""
    try:
        built = False
        for _ in range(25):
            if room['gameState'] != 'playing':
                break
            state, _ = _bot_bridge.room_to_state(room)
            action = _bot_mcts.choose_action(
                state, time_budget_ms=MCTS_TIME_BUDGET_MS, max_sims=MCTS_MAX_SIMS)
            if action is None or action[0] in ('end_turn', 'play_dev', 'move_robber'):
                break
            if not apply_mcts_action(room, slot, action):
                break
            built = True
        return True
    except Exception as e:
        print(f"[MCTS] fallback to heuristic: {e}")
        return False

def schedule_bot_action(room_code):
    asyncio.create_task(run_bot_action(room_code))

async def run_bot_action(room_code):
    await asyncio.sleep(1.2)
    room = rooms.get(room_code)
    if not room or room['gameState'] in ['lobby', 'gameover']:
        return

    active_slot = room['slots'][room['currentPlayerIndex']]
    if not active_slot or not active_slot['type'].startswith('bot'):
        return

    if room['gameState'] == 'robberMove':
        current_robber = room['robberHex']
        valid_hexes = [h for h in room['board']['hexes'] if h['resource'] != 'water' and not (current_robber and current_robber['q'] == h['q'] and current_robber['r'] == h['r'])]
        if valid_hexes:
            hex_choice = random.choice(valid_hexes)
            room['robberHex'] = {'q': hex_choice['q'], 'r': hex_choice['r']}
            room['gameLog'].append(f"{active_slot['username']} moved the Robber.")

            adjacent_players = []
            for v_id in hex_choice['vertices']:
                v = room['board']['vertices'][v_id]
                if v['owner'] is not None and v['owner'] != active_slot['index']:
                    owner_slot = room['slots'][v['owner']]
                    if owner_slot and owner_slot['type'] != 'empty':
                        total_res = sum(owner_slot['resources'].values())
                        if total_res > 0 and owner_slot['index'] not in adjacent_players:
                            adjacent_players.append(owner_slot['index'])

            if adjacent_players:
                target_idx = random.choice(adjacent_players)
                target_slot = room['slots'][target_idx]
                resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
                available = [res for res in resources if target_slot['resources'].get(res, 0) > 0]
                if available:
                    stolen = random.choice(available)
                    target_slot['resources'][stolen] -= 1
                    active_slot['resources'][stolen] = active_slot['resources'].get(stolen, 0) + 1
                    room['gameLog'].append(f"{active_slot['username']} stole 1 card from {target_slot['username']}.")

            if 'robberReturnState' in room and room['robberReturnState']:
                room['gameState'] = room['robberReturnState']['state']
                room['diceRolled'] = room['robberReturnState']['diceRolled']
                room['robberReturnState'] = None
            else:
                room['gameState'] = 'playing'
                room['diceRolled'] = True
            await broadcast_game_state(room)
            schedule_bot_action(room_code)
        return

    if room['gameState'] == 'setup':
        if room['setupSubStep'] == 'settlement':
            val_vertices = []
            for v in room['board']['vertices']:
                if v['owner'] is None and vertex_touches_land(room['board'], v['id']):
                    adj = get_adjacent_vertices(v['id'], room['board']['edges'])
                    close = any(room['board']['vertices'][adj_id]['owner'] is not None for adj_id in adj)
                    if not close:
                        val_vertices.append(v['id'])
            if val_vertices:
                choice = random.choice(val_vertices)
                vertex = room['board']['vertices'][choice]
                vertex['owner'] = active_slot['index']
                vertex['building'] = 'settlement'
                active_slot['victoryPoints'] += 1
                award_island_vp(room, choice, active_slot)
                room['lastSetupSettlement'] = choice
                room['setupSubStep'] = 'road'
                room['gameLog'].append(f"{active_slot['username']} placed a starting settlement.")

                # Distribute starting resources
                N = len(room['slots'])
                if room['setupStep'] >= N:
                    for hex_tile in room['board']['hexes']:
                        if choice in hex_tile['vertices']:
                            if hex_tile['resource'] not in ['desert', 'water']:
                                if room['bank'] and room['bank'].get(hex_tile['resource'], 0) > 0:
                                    room['bank'][hex_tile['resource']] -= 1
                                    active_slot['resources'][hex_tile['resource']] = active_slot['resources'].get(hex_tile['resource'], 0) + 1
                                    room['gameLog'].append(f"{active_slot['username']} received starting resource: 1 {hex_tile['resource']}.")

                await broadcast_game_state(room)
                schedule_bot_action(room_code)

        elif room['setupSubStep'] == 'road':
            val_edges = []
            for e in room['board']['edges']:
                if e['owner'] is None and e.get('land') and (e['v1'] == room['lastSetupSettlement'] or e['v2'] == room['lastSetupSettlement']):
                    val_edges.append(e['id'])
            if val_edges:
                choice = random.choice(val_edges)
                edge = next(e for e in room['board']['edges'] if e['id'] == choice)
                edge['owner'] = active_slot['index']
                edge['type'] = 'road'
                room['gameLog'].append(f"{active_slot['username']} placed a starting road.")

                N = len(room['slots'])
                room['setupStep'] += 1
                room['setupSubStep'] = 'settlement'
                room['lastSetupSettlement'] = None

                if room['setupStep'] == 2 * N:
                    room['gameState'] = 'playing'
                    room['currentPlayerIndex'] = 0
                    room['diceRolled'] = False
                    room['gameLog'].append("Setup complete! Match gameplay starts. Roll the dice!")
                else:
                    next_active_idx = room['setupStep'] if room['setupStep'] < N else (2 * N - 1 - room['setupStep'])
                    room['currentPlayerIndex'] = next_active_idx
                    target_slot = room['slots'][next_active_idx]
                    room['gameLog'].append(f"It is now {target_slot['username']}'s turn to place.")

                await broadcast_game_state(room)
                schedule_bot_action(room_code)
        return

    if room['gameState'] == 'playing':
        if not room['diceRolled']:
            # Check if bot has Knight to play
            if 'Knight' in active_slot.get('devCards', []) and not active_slot.get('devCardPlayedThisTurn', False):
                active_slot['devCards'].remove('Knight')
                active_slot['knightsPlayed'] = active_slot.get('knightsPlayed', 0) + 1
                active_slot['devCardPlayedThisTurn'] = True
                
                room['robberReturnState'] = {
                    'state': 'playing',
                    'diceRolled': False
                }
                room['gameState'] = 'robberMove'
                room['gameLog'].append(f"{active_slot['username']} played a Knight card.")
                check_largest_army(room)
                check_victory(room, active_slot)
                
                await broadcast_game_state(room)
                schedule_bot_action(room_code)
                return

            if room['balancedDice']:
                d1, d2 = roll_dice_balanced(room)
            else:
                d1 = random.randint(1, 6)
                d2 = random.randint(1, 6)
            total = d1 + d2
            room['lastDiceRoll'] = [d1, d2]
            room['diceRolled'] = True
            room['gameLog'].append(f"{active_slot['username']} rolled a {total} ({d1} + {d2}).")

            if room['gameMode'] == 'cities':
                resolve_event_die(room, d1)
                if room['gameState'] == 'gameover':
                    await broadcast_game_state(room)
                    return

            if total != 7:
                distribute_resources(room, total)
                if resolve_gold_after_roll(room):
                    room['goldReturnState'] = 'playing'
                    room['gameState'] = 'goldChoice'
                await broadcast_game_state(room)
                await sio.emit('sound', 'roll', room=room_code)
                schedule_bot_action(room_code)
            else:
                room['gameLog'].append("A 7 was rolled! The Robber is activated.")

                # Check discards
                discards_pending = {}
                for slot in room['slots']:
                    if slot['type'] != 'empty':
                        total_cards = hand_size(slot)
                        if total_cards > discard_limit(slot):
                            discards_pending[slot['index']] = total_cards // 2
                room['discardsPending'] = discards_pending

                # Bot discards
                for slot in room['slots']:
                    if slot['type'] != 'empty' and slot['type'].startswith('bot') and slot['index'] in room['discardsPending']:
                        cards_to_discard = room['discardsPending'][slot['index']]
                        discard_random_cards(room, slot, cards_to_discard)
                        room['gameLog'].append(f"{slot['username']} discarded {cards_to_discard} cards.")
                        room['discardsPending'].pop(slot['index'], None)

                if room['discardsPending']:
                    room['gameState'] = 'discard'
                else:
                    room['gameState'] = 'robberMove'

                await broadcast_game_state(room)
                await sio.emit('sound', 'roll', room=room_code)
                schedule_bot_action(room_code)
        else:
            # Build phase: MCTS drives basic-mode `bot_mcts`; everyone else uses
            # the heuristic. MCTS falls back to the heuristic on any error.
            used_mcts = False
            built_something = False
            if active_slot['type'] == 'bot_mcts' and room['gameMode'] == 'basic':
                used_mcts = mcts_build_phase(room, active_slot)
                built_something = used_mcts
            if not used_mcts:
                bot_trade_if_needed(room, active_slot)
                built_something = do_bot_build_phase(room, active_slot)

            async def end_bot_turn():
                await asyncio.sleep(1.2)
                r_check2 = rooms.get(room_code)
                if not r_check2 or r_check2['currentPlayerIndex'] != active_slot['index'] or r_check2['gameState'] == 'gameover':
                    return
                advance_turn(r_check2)
                next_player = r_check2['slots'][r_check2['currentPlayerIndex']]
                r_check2['gameLog'].append(f"It is now {next_player['username']}'s turn.")
                await broadcast_game_state(r_check2)
                schedule_bot_action(room_code)

            asyncio.create_task(end_bot_turn())

            if built_something:
                await broadcast_game_state(room)
                await sio.emit('sound', 'build', room=room_code)


async def get_session_room_and_slot(sid):
    import time
    # 1. Try Socket.IO session store
    session = None
    try:
        session = await sio.get_session(sid)
    except Exception:
        pass

    if session:
        room_code = session.get('room_code')
        username = session.get('username')
        if room_code:
            room = rooms.get(room_code)
            if room:
                slot = next((s for s in room['slots'] if s['username'] == username), None)
                if slot:
                    room['lastActionTime'] = time.time()
                    return room, slot

    # 2. Fallback: Scan all active rooms for the slot matching this socket sid
    for r_code, room in rooms.items():
        for slot in room['slots']:
            if slot.get('id') == sid:
                # Re-save session for subsequent requests
                try:
                    await sio.save_session(sid, {'room_code': r_code, 'username': slot['username']})
                except Exception:
                    pass
                room['lastActionTime'] = time.time()
                return room, slot

    return None, None


# Helper functions for port ratios
def get_player_trade_ratios(room, player_idx):
    ratios = {
        'wood': 4,
        'brick': 4,
        'sheep': 4,
        'wheat': 4,
        'ore': 4
    }
    
    ports = room['board'].get('ports', [])
    for port in ports:
        has_access = False
        for v_id in port.get('vertices', []):
            v = room['board']['vertices'][v_id]
            if v['owner'] == player_idx and v['building'] in ['settlement', 'city']:
                has_access = True
                break
        
        if has_access:
            ptype = port['type']
            if ptype == 'generic':
                for res in ratios:
                    ratios[res] = min(ratios[res], 3)
            else:
                if ptype in ratios:
                    ratios[ptype] = min(ratios[ptype], 2)

    # Merchant progress card: its holder trades that hex's resource at 2:1.
    merchant = room.get('merchant')
    if merchant and merchant.get('owner') == player_idx and merchant.get('resource') in ratios:
        ratios[merchant['resource']] = min(ratios[merchant['resource']], 2)

    return ratios


def get_longest_road_for_player(board, player_idx, allow_ships=False):
    """Longest continuous route of the player's edges (longest trail, no edge
    reused). With allow_ships (Seafarers) the route may mix roads and ships, but
    a road and a ship only connect through the player's own settlement/city; two
    edges of the same type also connect at an empty vertex. Opponent buildings
    break the route."""
    edges = board.get('edges', [])
    vertices = board.get('vertices', [])

    if allow_ships:
        player_edges = [e for e in edges if e['owner'] == player_idx]
    else:
        player_edges = [e for e in edges if e['owner'] == player_idx and e.get('type') != 'ship']
    if not player_edges:
        return 0

    adj = {}
    for e in player_edges:
        etype = e.get('type', 'road')
        v1, v2 = e['v1'], e['v2']
        adj.setdefault(v1, []).append((v2, e['id'], etype))
        adj.setdefault(v2, []).append((v1, e['id'], etype))

    def dfs(v, visited, incoming_type):
        v_owner = vertices[v]['owner']
        # Can't route through an opponent's building.
        if v_owner is not None and v_owner != player_idx:
            return 0
        local_max = 0
        for neighbor, edge_id, etype in adj.get(v, []):
            if edge_id in visited:
                continue
            # Switching between road and ship is only allowed at your own building.
            if incoming_type is not None and incoming_type != etype and v_owner != player_idx:
                continue
            n_owner = vertices[neighbor]['owner']
            is_passable = (n_owner is None) or (n_owner == player_idx)
            visited.add(edge_id)
            length = 1 + dfs(neighbor, visited, etype) if is_passable else 1
            visited.remove(edge_id)
            if length > local_max:
                local_max = length
        return local_max

    max_length = 0
    for start_v in adj:
        s_owner = vertices[start_v]['owner']
        if s_owner is not None and s_owner != player_idx:
            continue
        length = dfs(start_v, set(), None)
        if length > max_length:
            max_length = length

    return max_length


def check_longest_road(room):
    current_holder_idx = room.get('longestRoadHolder')
    
    allow_ships = room.get('gameMode') == 'seafarers'
    lengths = {}
    for slot in room['slots']:
        if slot['type'] != 'empty':
            lengths[slot['index']] = get_longest_road_for_player(room['board'], slot['index'], allow_ships)
            slot['longestRoadLength'] = lengths[slot['index']]
            
    max_len = 0
    candidates = []
    for p_idx, l in lengths.items():
        if l >= 5:
            if l > max_len:
                max_len = l
                candidates = [p_idx]
            elif l == max_len:
                candidates.append(p_idx)
                
    new_holder_idx = current_holder_idx
    
    if max_len >= 5:
        if current_holder_idx is not None:
            if current_holder_idx in candidates:
                new_holder_idx = current_holder_idx
            else:
                if len(candidates) == 1:
                    new_holder_idx = candidates[0]
                else:
                    new_holder_idx = None
        else:
            if len(candidates) == 1:
                new_holder_idx = candidates[0]
            else:
                new_holder_idx = None
    else:
        new_holder_idx = None
        
    if new_holder_idx != current_holder_idx:
        if current_holder_idx is not None:
            old_holder = room['slots'][current_holder_idx]
            old_holder['victoryPoints'] = max(0, old_holder['victoryPoints'] - 2)
            room['gameLog'].append(f"{old_holder['username']} lost the Longest Road!")
            
        if new_holder_idx is not None:
            new_holder = room['slots'][new_holder_idx]
            new_holder['victoryPoints'] += 2
            room['gameLog'].append(f"{new_holder['username']} claimed the Longest Road (+2 Victory Points) with a chain of {max_len} roads!")
            
        room['longestRoadHolder'] = new_holder_idx


def check_road_victory(room):
    # Gaining the Longest Road bonus (+2 VP) can be the move that wins the game.
    # check_longest_road only adjusts VP, so we must re-check victory for the holder.
    if room['gameState'] == 'gameover':
        return
    holder_idx = room.get('longestRoadHolder')
    if holder_idx is not None:
        check_victory(room, room['slots'][holder_idx])


# Helper functions for dev cards
def check_largest_army(room):
    # Cities & Knights replaces Largest Army with the knight system.
    if room.get('gameMode') == 'cities':
        return
    current_holder_idx = room.get('largestArmyHolder')
    max_knights = 0
    max_player_idx = None
    
    for slot in room['slots']:
        if slot['type'] != 'empty':
            kp = slot.get('knightsPlayed', 0)
            if kp >= 3:
                if kp > max_knights:
                    max_knights = kp
                    max_player_idx = slot['index']
                elif kp == max_knights and slot['index'] == current_holder_idx:
                    max_player_idx = current_holder_idx

    if max_player_idx != current_holder_idx:
        if current_holder_idx is not None:
            old_holder = room['slots'][current_holder_idx]
            old_holder['victoryPoints'] = max(0, old_holder['victoryPoints'] - 2)
            room['gameLog'].append(f"{old_holder['username']} lost the Largest Army!")
        
        if max_player_idx is not None:
            new_holder = room['slots'][max_player_idx]
            new_holder['victoryPoints'] += 2
            room['gameLog'].append(f"{new_holder['username']} claimed the Largest Army (+2 Victory Points) with {max_knights} Knights played!")
            
        room['largestArmyHolder'] = max_player_idx

def check_victory(room, player):
    vp_cards = player['devCards'].count('Victory Point') + player.get('devCardsBoughtThisTurn', []).count('Victory Point')
    total_vp = player['victoryPoints'] + vp_cards
    if total_vp >= room['victoryPointsLimit']:
        room['gameState'] = 'gameover'
        room['winner'] = player['username']
        player['victoryPoints'] = total_vp
        room['gameLog'].append(f"{player['username']} wins the match by reaching {total_vp} Victory Points (including {vp_cards} Victory Point cards)!")
        save_match(room['code'], player['username'], total_vp, room['gameMode'])
        return True
    return False


def award_metropolis(room, slot, track):
    """Cities & Knights Metropolis, per official rules. A track's Metropolis
    (+2 VP; turns one of the player's cities into a 4-VP metropolis) is claimed
    on reaching the 4th improvement level. It can be *seized* from a holder who
    is still at level 4 by a rival who reaches level 5; once you are at level 5
    your metropolis is protected and can never be taken."""
    if room.get('gameMode') != 'cities':
        return
    level = slot['improvements'].get(track, 0)
    if level < 4:
        return
    holder_idx = room['metropolisHolders'].get(track)
    if holder_idx == slot['index']:
        return  # already ours (e.g. going 4 -> 5)

    if holder_idx is not None:
        holder = room['slots'][holder_idx]
        # A metropolis can only be seized from a holder still at level 4, and
        # only by a player who has reached level 5.
        if level < 5 or holder['improvements'].get(track, 0) >= 5:
            return
        holder['victoryPoints'] = max(0, holder['victoryPoints'] - 2)
        if track in holder.get('metropolis', []):
            holder['metropolis'].remove(track)
        for v in room['board']['vertices']:
            if v['owner'] == holder['index'] and v.get('metropolis') == track:
                v['metropolis'] = None
        room['gameLog'].append(f"{slot['username']} seized the {track.capitalize()} Metropolis from {holder['username']}!")

    room['metropolisHolders'][track] = slot['index']
    slot.setdefault('metropolis', [])
    if track not in slot['metropolis']:
        slot['metropolis'].append(track)
    slot['victoryPoints'] += 2
    # Mark one of the player's ordinary cities as the metropolis so barbarians
    # can never reduce it.
    metro_v = next((v for v in room['board']['vertices']
                    if v['owner'] == slot['index'] and v['building'] == 'city' and not v.get('metropolis')), None)
    if metro_v:
        metro_v['metropolis'] = track
    room['gameLog'].append(f"{slot['username']} built the {track.capitalize()} Metropolis (+2 Victory Points)!")
    check_victory(room, slot)

# Socket Event Handlers
@sio.event
async def connect(sid, environ):
    print(f"Socket connected: {sid}")

@sio.event
async def disconnect(sid):
    session = await sio.get_session(sid)
    if session:
        room_code = session.get('room_code')
        username = session.get('username')
        if room_code and username:
            room = rooms.get(room_code)
            if room:
                slot = next((s for s in room['slots'] if s['username'] == username), None)
                if slot:
                    slot['disconnected'] = True
                    room['gameLog'].append(f"{username} disconnected.")

                    active_count = len([s for s in room['slots'] if s['type'] == 'human' and not s['disconnected']])
                    if active_count == 0:
                         print(f"Deleting empty room: {room_code}")
                         rooms.pop(room_code, None)
                    else:
                         await broadcast_game_state(room)

@sio.on('createRoom')
async def on_create_room(sid, data):
    import time
    code = data['roomCode'].strip().upper()
    username = data['username'].strip()
    print(f"[DEBUG] on_create_room: sid={sid}, code={code}, username={username}")

    if not code or not username:
        await sio.emit('errorMsg', 'Invalid room code or username.', to=sid)
        return

    if data.get('gameMode') not in ('basic', 'seafarers', 'cities'):
        await sio.emit('errorMsg', 'Invalid game mode.', to=sid)
        return

    if code in rooms:
        await sio.emit('errorMsg', 'Room code is already active.', to=sid)
        return

    # Set up slots
    initialized_slots = []
    used_bot_names = set()
    for idx, s in enumerate(data['slots']):
        u_name = None
        s_id = None
        if s['type'] == 'human':
            if idx == 0:
                u_name = username
                s_id = sid
        elif s['type'].startswith('bot'):
            u_name = get_bot_name(s['type'], used_bot_names)
            used_bot_names.add(u_name)

        initialized_slots.append({
            'index': idx,
            'type': s['type'],
            'color': s['color'],
            'username': u_name,
            'id': s_id,
            'resources': { 'wood': 0, 'brick': 0, 'sheep': 0, 'wheat': 0, 'ore': 0 },
            'victoryPoints': 0,
            'knights': 0,
            'devCards': [],
            'devCardsBoughtThisTurn': [],
            'knightsPlayed': 0,
            'devCardPlayedThisTurn': False,
            'disconnected': False,
            'secret': secrets.token_hex(16) if s_id else None,
            'ready': True if (idx == 0 and s['type'] == 'human') else False,
            # Cities & Knights state
            'commodities': { 'coin': 0, 'cloth': 0, 'paper': 0 },
            'improvements': { 'trade': 0, 'politics': 0, 'science': 0 },
            'cityWalls': 0,
            'metropolis': [],  # tracks for which this player holds the metropolis
            'progressCards': []
        })

    # Resolve the chosen map (falls back to the mode default if missing/invalid).
    map_layout = map_layouts.resolve_map(data['gameMode'], data.get('mapId'))
    board = generate_board(data['gameMode'], map_layout['id'])
    # The robber starts on the desert. Seafarers boards have no desert, so start
    # it on a water hex where it blocks nothing until a 7 is rolled.
    desert_hex = next((h for h in board['hexes'] if h['resource'] == 'desert'), None)
    if not desert_hex:
        desert_hex = next((h for h in board['hexes'] if h['resource'] == 'water'), None)

    room = {
        'code': code,
        'gameState': 'lobby',
        'gameMode': data['gameMode'],
        'mapId': map_layout['id'],
        'hideBankCards': data['hideBankCards'],
        'balancedDice': data['balancedDice'],
        # Cities & Knights is played to 13 VP officially.
        'victoryPointsLimit': 13 if data['gameMode'] == 'cities' else (int(data['victoryPointsLimit']) if data['victoryPointsLimit'] else 10),
        'turnTimeoutLimit': int(data.get('turnTimeoutLimit', 60)),
        'lastActionTime': time.time(),
        'barbarianStep': 0,
        'slots': initialized_slots,
        'currentPlayerIndex': 0,
        'setupStep': 0,
        'setupSubStep': 'settlement',
        'lastSetupSettlement': None,
        'diceRolled': False,
        'lastDiceRoll': None,
        'board': board,
        'winner': None,
        'gameLog': [f"Room {code} created.", f"{username} joined as host."],
        'bank': { 'wood': 19, 'brick': 19, 'sheep': 19, 'wheat': 19, 'ore': 19 },
        'robberHex': {'q': desert_hex['q'], 'r': desert_hex['r']} if desert_hex else {'q': 0, 'r': 0},
        'discardsPending': {},
        # Seafarers state
        'pirateHex': None,          # {'q','r'} once placed on a sea hex
        'goldPending': {},          # {player_idx: number of resources to choose}
        'goldReturnState': None,
        'shipMovedThisTurn': False,
        'discoveredIslands': set(),  # island ids already settled (not broadcast)
        # Cities & Knights state
        'commodityBank': { 'coin': 0, 'cloth': 0, 'paper': 0 },  # filled at start
        'metropolisHolders': { 'trade': None, 'politics': None, 'science': None },
        'merchant': None,       # {'owner','q','r','resource'} — Merchant progress card
        'bishopActive': False,
        'forcedDice': None
    }

    rooms[code] = room
    await sio.save_session(sid, {'room_code': code, 'username': username})
    await sio.enter_room(sid, code)
    host_slot = room['slots'][0]
    if host_slot.get('secret'):
        await sio.emit('session', {'token': host_slot['secret']}, to=sid)
    await broadcast_game_state(room)

@sio.on('joinRoom')
async def on_join_room(sid, data):
    code = data['roomCode'].strip().upper()
    username = data['username'].strip()
    print(f"[DEBUG] on_join_room: sid={sid}, code={code}, username={username}")

    if not code or not username:
        await sio.emit('errorMsg', 'Invalid room code or username.', to=sid)
        return

    room = rooms.get(code)
    if not room:
        await sio.emit('errorMsg', 'Room not found.', to=sid)
        return

    # Reconnect check
    provided_token = data.get('token')
    existing_slot = next((s for s in room['slots'] if s['username'] == username and s['type'] == 'human'), None)
    if existing_slot:
        # A slot that already has a secret can only be reclaimed with the matching
        # token. This prevents anyone who knows the room code + a player's name from
        # hijacking their seat and reading their private dev cards.
        if existing_slot.get('secret') and existing_slot['secret'] != provided_token:
            await sio.emit('errorMsg', 'That name is already taken in this room.', to=sid)
            return
        import time
        existing_slot['id'] = sid
        existing_slot['disconnected'] = False
        if not existing_slot.get('secret'):
            existing_slot['secret'] = secrets.token_hex(16)
        await sio.save_session(sid, {'room_code': code, 'username': username})
        await sio.enter_room(sid, code)
        await sio.emit('session', {'token': existing_slot['secret']}, to=sid)
        room['gameLog'].append(f"{username} reconnected.")
        room['lastActionTime'] = time.time()
        await broadcast_game_state(room)
        return

    if room['gameState'] != 'lobby':
        await sio.emit('errorMsg', 'Game has already started.', to=sid)
        return

    open_slot = next((s for s in room['slots'] if s['type'] == 'human' and s['username'] is None), None)
    if not open_slot:
        await sio.emit('errorMsg', 'Room is full.', to=sid)
        return

    import time
    open_slot['id'] = sid
    open_slot['username'] = username
    open_slot['disconnected'] = False
    open_slot['ready'] = False
    open_slot['secret'] = secrets.token_hex(16)
    room['gameLog'].append(f"{username} joined the room.")
    room['lastActionTime'] = time.time()

    await sio.save_session(sid, {'room_code': code, 'username': username})
    await sio.enter_room(sid, code)
    await sio.emit('session', {'token': open_slot['secret']}, to=sid)
    await broadcast_game_state(room)

@sio.on('startGame')
async def on_start_game(sid):
    import time
    room, slot = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'lobby':
        return

    # Check if host
    if slot['index'] != 0:
        await sio.emit('errorMsg', 'Only the host can start the game.', to=sid)
        return

    # Check ready states
    humans = [s for s in room['slots'] if s['type'] == 'human' and s['username'] is not None]
    not_ready = [s['username'] for s in humans if not s.get('ready', False)]
    if not_ready:
        await sio.emit('errorMsg', f"Cannot start match. Players not ready: {', '.join(not_ready)}", to=sid)
        return

    active_slots = [s for s in room['slots'] if s['type'] != 'empty']
    if not active_slots:
        await sio.emit('errorMsg', 'Cannot start a game with no players.', to=sid)
        return

    random.shuffle(active_slots)
    for idx, s in enumerate(active_slots):
        s['index'] = idx
        s['devCards'] = []
        s['devCardsBoughtThisTurn'] = []
        s['knightsPlayed'] = 0
        s['devCardPlayedThisTurn'] = False
        s['progressCards'] = []
        s['ready'] = True # reset for game VPs and state
        room['lastActionTime'] = time.time()

    if room['gameMode'] == 'cities':
        room['progressDecks'] = build_progress_decks()

    dev_deck = []
    for _ in range(14): dev_deck.append('Knight')
    for _ in range(5): dev_deck.append('Victory Point')
    for _ in range(2): dev_deck.append('Road Building')
    for _ in range(2): dev_deck.append('Year of Plenty')
    for _ in range(2): dev_deck.append('Monopoly')
    random.shuffle(dev_deck)

    room['devCardsDeck'] = dev_deck
    room['slots'] = active_slots
    room['gameState'] = 'setup'
    room['setupStep'] = 0
    room['setupSubStep'] = 'settlement'
    room['currentPlayerIndex'] = 0

    room['gameLog'].append('The game has started! Player order has been randomized.')
    order_names = " -> ".join(s['username'] for s in room['slots'])
    room['gameLog'].append(f"Player Order: {order_names}")
    room['gameLog'].append(f"It is now {room['slots'][0]['username']}'s turn. Setup Phase: Place your first settlement.")

    await broadcast_game_state(room)
    schedule_bot_action(room['code'])

@sio.on('buildSettlement')
async def on_build_settlement(sid, raw_vertex_id):
    room, active_player = await get_session_room_and_slot(sid)
    if not room:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    # Check piece cap (5 Settlements)
    settlements_count = len([v for v in room['board']['vertices'] if v['owner'] == active_player['index'] and v['building'] == 'settlement'])
    if settlements_count >= 5:
        await sio.emit('errorMsg', 'You have reached the limit of 5 Settlements.', to=sid)
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    if not vertex or vertex['owner'] is not None:
        await sio.emit('errorMsg', 'Settlement already exists here or path is invalid.', to=sid)
        return
    if vertex.get('knight') is not None:
        await sio.emit('errorMsg', 'A knight is standing on that intersection.', to=sid)
        return

    adj = get_adjacent_vertices(vertex_id, room['board']['edges'])
    for adj_id in adj:
        if room['board']['vertices'][adj_id]['owner'] is not None:
            await sio.emit('errorMsg', 'Violates distance rule (too close to another settlement).', to=sid)
            return

    if not vertex_touches_land(room['board'], vertex_id):
        await sio.emit('errorMsg', 'Settlements must be built on the coast or on land, not in open sea.', to=sid)
        return

    if room['gameState'] == 'setup':
        if room['setupSubStep'] != 'settlement':
            return

        vertex['owner'] = active_player['index']
        vertex['building'] = 'settlement'
        active_player['victoryPoints'] += 1
        award_island_vp(room, vertex_id, active_player)
        room['lastSetupSettlement'] = vertex_id
        room['setupSubStep'] = 'road'
        room['gameLog'].append(f"{active_player['username']} placed a starting settlement.")

        N = len(room['slots'])
        if room['setupStep'] >= N:
            for hex_tile in room['board']['hexes']:
                if vertex_id in hex_tile['vertices']:
                    if hex_tile['resource'] not in ['desert', 'water']:
                        if room['bank'] and room['bank'].get(hex_tile['resource'], 0) > 0:
                            room['bank'][hex_tile['resource']] -= 1
                            active_player['resources'][hex_tile['resource']] = active_player['resources'].get(hex_tile['resource'], 0) + 1
                            room['gameLog'].append(f"{active_player['username']} received starting resource: 1 {hex_tile['resource']}.")
                        else:
                            room['gameLog'].append(f"{active_player['username']} could not receive starting resource: 1 {hex_tile['resource']} (Bank out of stock).")

        check_longest_road(room)
        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)

    elif room['gameState'] == 'playing':
        if not room['diceRolled']:
            return

        r = active_player['resources']
        if r.get('wood', 0) < 1 or r.get('brick', 0) < 1 or r.get('wheat', 0) < 1 or r.get('sheep', 0) < 1:
            await sio.emit('errorMsg', 'Insufficient resources.', to=sid)
            return

        has_road_conn = any((e['v1'] == vertex_id or e['v2'] == vertex_id) and e['owner'] == active_player['index'] for e in room['board']['edges'])
        if not has_road_conn:
            await sio.emit('errorMsg', 'Must connect to one of your roads.', to=sid)
            return

        r['wood'] -= 1; r['brick'] -= 1; r['wheat'] -= 1; r['sheep'] -= 1
        if room['bank']:
            room['bank']['wood'] = min(19, room['bank']['wood'] + 1)
            room['bank']['brick'] = min(19, room['bank']['brick'] + 1)
            room['bank']['wheat'] = min(19, room['bank']['wheat'] + 1)
            room['bank']['sheep'] = min(19, room['bank']['sheep'] + 1)

        vertex['owner'] = active_player['index']
        vertex['building'] = 'settlement'
        active_player['victoryPoints'] += 1
        award_island_vp(room, vertex_id, active_player)
        room['gameLog'].append(f"{active_player['username']} built a settlement.")

        if active_player['victoryPoints'] >= room['victoryPointsLimit']:
            room['gameState'] = 'gameover'
            room['winner'] = active_player['username']
            room['gameLog'].append(f"{active_player['username']} won the match by reaching {room['victoryPointsLimit']} Victory Points!")
            save_match(room['code'], active_player['username'], active_player['victoryPoints'], room['gameMode'])

        check_longest_road(room)
        check_road_victory(room)
        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)

@sio.on('buildCity')
async def on_build_city(sid, raw_vertex_id):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or not room['diceRolled']:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    # Check piece cap (4 Cities)
    cities_count = len([v for v in room['board']['vertices'] if v['owner'] == active_player['index'] and v['building'] == 'city'])
    if cities_count >= 4:
        await sio.emit('errorMsg', 'You have reached the limit of 4 Cities.', to=sid)
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    if not vertex or vertex['owner'] != active_player['index'] or vertex['building'] != 'settlement':
        await sio.emit('errorMsg', 'You can only upgrade an existing settlement to a city.', to=sid)
        return

    r = active_player['resources']
    # Medicine progress card (Cities & Knights): this upgrade costs 2 Ore + 1 Wheat.
    medicine = bool(active_player.get('medicineDiscount'))
    ore_cost, wheat_cost = (2, 1) if medicine else (3, 2)
    if r.get('ore', 0) < ore_cost or r.get('wheat', 0) < wheat_cost:
        await sio.emit('errorMsg', f'Insufficient resources to build a City. Requires {ore_cost} Ore and {wheat_cost} Wheat.', to=sid)
        return

    r['ore'] -= ore_cost; r['wheat'] -= wheat_cost
    if medicine:
        active_player['medicineDiscount'] = False
    if room['bank']:
        room['bank']['ore'] = min(19, room['bank']['ore'] + ore_cost)
        room['bank']['wheat'] = min(19, room['bank']['wheat'] + wheat_cost)

    vertex['building'] = 'city'
    active_player['victoryPoints'] += 1
    room['gameLog'].append(f"{active_player['username']} upgraded a settlement to a City.")

    if active_player['victoryPoints'] >= room['victoryPointsLimit']:
        room['gameState'] = 'gameover'
        room['winner'] = active_player['username']
        room['gameLog'].append(f"{active_player['username']} won the match by reaching {room['victoryPointsLimit']} Victory Points!")
        save_match(room['code'], active_player['username'], active_player['victoryPoints'], room['gameMode'])

    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('buyDevCard')
async def on_buy_dev_card(sid):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or not room['diceRolled']:
        return

    if room['gameMode'] == 'cities':
        await sio.emit('errorMsg', 'Development cards are not used in Cities & Knights.', to=sid)
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    r = active_player['resources']
    if r.get('ore', 0) < 1 or r.get('wheat', 0) < 1 or r.get('sheep', 0) < 1:
        await sio.emit('errorMsg', 'Insufficient resources to buy a Development Card. Requires 1 Ore, 1 Wheat, and 1 Sheep.', to=sid)
        return

    if not room['devCardsDeck']:
        await sio.emit('errorMsg', 'The Development Card deck is empty.', to=sid)
        return

    r['ore'] -= 1; r['wheat'] -= 1; r['sheep'] -= 1
    if room['bank']:
        room['bank']['ore'] = min(19, room['bank']['ore'] + 1)
        room['bank']['wheat'] = min(19, room['bank']['wheat'] + 1)
        room['bank']['sheep'] = min(19, room['bank']['sheep'] + 1)

    card_drawn = room['devCardsDeck'].pop()
    if card_drawn == 'Victory Point':
        active_player['devCards'].append(card_drawn)
    else:
        if 'devCardsBoughtThisTurn' not in active_player:
            active_player['devCardsBoughtThisTurn'] = []
        active_player['devCardsBoughtThisTurn'].append(card_drawn)
    room['gameLog'].append(f"{active_player['username']} bought a Development Card.")

    check_victory(room, active_player)
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('buildRoad')
async def on_build_road(sid, edge_id):
    room, active_player = await get_session_room_and_slot(sid)
    if not room:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    # Check piece cap (15 Roads)
    roads_count = len([e for e in room['board']['edges'] if e['owner'] == active_player['index'] and e.get('type') != 'ship'])
    if roads_count >= 15:
        await sio.emit('errorMsg', 'You have reached the limit of 15 Roads.', to=sid)
        return

    edge = next((e for e in room['board']['edges'] if e['id'] == edge_id), None)
    if not edge or edge['owner'] is not None:
        await sio.emit('errorMsg', 'Invalid path.', to=sid)
        return
    if not edge.get('land'):
        await sio.emit('errorMsg', 'Roads can only run on land edges — use a Ship on sea routes.', to=sid)
        return

    if room['gameState'] == 'setup':
        if room['setupSubStep'] != 'road':
            return
        if edge['v1'] != room['lastSetupSettlement'] and edge['v2'] != room['lastSetupSettlement']:
            await sio.emit('errorMsg', 'Road must connect to your newly placed settlement.', to=sid)
            return

        edge['owner'] = active_player['index']
        edge['type'] = 'road'
        room['gameLog'].append(f"{active_player['username']} placed a starting road.")

        N = len(room['slots'])
        room['setupStep'] += 1
        room['setupSubStep'] = 'settlement'
        room['lastSetupSettlement'] = None

        if room['setupStep'] == 2 * N:
            room['gameState'] = 'playing'
            room['currentPlayerIndex'] = 0
            room['diceRolled'] = False
            room['gameLog'].append("Setup complete! Match starts. Roll the dice!")
        else:
            next_active_idx = room['setupStep'] if room['setupStep'] < N else (2 * N - 1 - room['setupStep'])
            room['currentPlayerIndex'] = next_active_idx
            target_slot = room['slots'][next_active_idx]
            room['gameLog'].append(f"It is now {target_slot['username']}'s turn to place.")

        check_longest_road(room)
        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)
        schedule_bot_action(room['code'])

    elif room['gameState'] == 'roadBuilding':
        if not is_road_connection_valid(room['board'], edge, active_player['index']):
            await sio.emit('errorMsg', 'Road must connect to your structures.', to=sid)
            return

        edge['owner'] = active_player['index']
        edge['type'] = 'road'
        room['gameLog'].append(f"{active_player['username']} built a free road (Road Building).")
        check_longest_road(room)
        check_road_victory(room)

        rb_state = room.get('roadBuildingState', {})
        roads_left = rb_state.get('roadsRemaining', 2) - 1
        
        # Check if they have reached the cap of 15 roads now
        roads_count = len([e for e in room['board']['edges'] if e['owner'] == active_player['index'] and e.get('type') != 'ship'])
        if roads_count >= 15:
            roads_left = 0 # force termination

        if roads_left > 0:
            rb_state['roadsRemaining'] = roads_left
        else:
            if 'roadBuildingReturnState' in room and room['roadBuildingReturnState']:
                room['gameState'] = room['roadBuildingReturnState']['state']
                room['diceRolled'] = room['roadBuildingReturnState']['diceRolled']
                room['roadBuildingReturnState'] = None
            else:
                room['gameState'] = 'playing'
            room['roadBuildingState'] = None

        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)

    elif room['gameState'] == 'playing':
        if not room['diceRolled']:
            return

        r = active_player['resources']
        if r.get('wood', 0) < 1 or r.get('brick', 0) < 1:
            await sio.emit('errorMsg', 'Insufficient resources.', to=sid)
            return

        if not is_road_connection_valid(room['board'], edge, active_player['index']):
            await sio.emit('errorMsg', 'Road must connect to your structures.', to=sid)
            return

        r['wood'] -= 1; r['brick'] -= 1
        if room['bank']:
            room['bank']['wood'] = min(19, room['bank']['wood'] + 1)
            room['bank']['brick'] = min(19, room['bank']['brick'] + 1)

        edge['owner'] = active_player['index']
        edge['type'] = 'road'
        room['gameLog'].append(f"{active_player['username']} built a road.")

        check_longest_road(room)
        check_road_victory(room)
        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)

@sio.on('rollDice')
async def on_roll_dice(sid):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or room['diceRolled']:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    if room.get('forcedDice'):
        # Alchemist progress card fixed this roll's dice.
        d1, d2 = room['forcedDice']
        room['forcedDice'] = None
    elif room['balancedDice']:
        d1, d2 = roll_dice_balanced(room)
    else:
        d1 = random.randint(1, 6)
        d2 = random.randint(1, 6)

    total = d1 + d2
    room['lastDiceRoll'] = [d1, d2]
    room['diceRolled'] = True
    room['gameLog'].append(f"{active_player['username']} rolled a {total} ({d1} + {d2}).")

    if room['gameMode'] == 'cities':
        resolve_event_die(room, d1)
        if room['gameState'] == 'gameover':
            await broadcast_game_state(room)
            return

    if total != 7:
        distribute_resources(room, total)
        if resolve_gold_after_roll(room):
            room['goldReturnState'] = 'playing'
            room['gameState'] = 'goldChoice'
        await broadcast_game_state(room)
        await sio.emit('sound', 'roll', room=room['code'])
        schedule_bot_action(room['code'])
    else:
        room['gameLog'].append("A 7 was rolled! The Robber is activated.")

        # Check discards
        discards_pending = {}
        for slot in room['slots']:
            if slot['type'] != 'empty':
                total_cards = hand_size(slot)
                if total_cards > discard_limit(slot):
                    discards_pending[slot['index']] = total_cards // 2
        room['discardsPending'] = discards_pending

        # Handle Bot discards immediately
        for slot in room['slots']:
            if slot['type'] != 'empty' and slot['type'].startswith('bot') and slot['index'] in room['discardsPending']:
                cards_to_discard = room['discardsPending'][slot['index']]
                discard_random_cards(room, slot, cards_to_discard)
                room['gameLog'].append(f"{slot['username']} discarded {cards_to_discard} cards.")
                room['discardsPending'].pop(slot['index'], None)

        if room['discardsPending']:
            room['gameState'] = 'discard'
        else:
            room['gameState'] = 'robberMove'

        await broadcast_game_state(room)
        await sio.emit('sound', 'roll', room=room['code'])
        schedule_bot_action(room['code'])

@sio.on('bankTrade')
async def on_bank_trade(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or not room['diceRolled']:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    offer = data['offer']
    demand = data['demand']
    resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
    commodities = ['coin', 'cloth', 'paper']
    if offer == demand:
        return

    offer_is_commodity = offer in commodities

    if offer_is_commodity:
        # Cities & Knights "Trade House" (Trade improvement level >= 3): trade 2
        # identical commodities for any 1 resource or commodity.
        if room['gameMode'] != 'cities' or active_player['improvements'].get('trade', 0) < 3:
            await sio.emit('errorMsg', 'Trading commodities requires the Trade House (Trade level 3).', to=sid)
            return
        if demand not in resources and demand not in commodities:
            return
        req_ratio = 2
        if active_player['commodities'].get(offer, 0) < req_ratio:
            await sio.emit('errorMsg', f'Insufficient commodities. You need {req_ratio} {offer}.', to=sid)
            return
    else:
        # Ordinary bank / harbour trade: resources only.
        if offer not in resources or demand not in resources:
            return
        ratios = get_player_trade_ratios(room, active_player['index'])
        req_ratio = ratios.get(offer, 4)
        # Merchant Fleet progress card: 2:1 on the chosen resource this turn.
        if active_player.get('merchantFleet') == offer:
            req_ratio = min(req_ratio, 2)
        if active_player['resources'].get(offer, 0) < req_ratio:
            await sio.emit('errorMsg', f'Insufficient resources. You need {req_ratio} {offer}.', to=sid)
            return

    demand_is_commodity = demand in commodities
    # Commodities have an unlimited supply; only resources draw from the bank.
    if not demand_is_commodity and room['bank'] and room['bank'].get(demand, 0) < 1:
        await sio.emit('errorMsg', f'The Bank is out of {demand} cards.', to=sid)
        return

    # Pay the offer.
    if offer_is_commodity:
        active_player['commodities'][offer] -= req_ratio
    else:
        active_player['resources'][offer] -= req_ratio
        if room['bank']:
            room['bank'][offer] = min(19, room['bank'][offer] + req_ratio)

    # Receive the demand.
    if demand_is_commodity:
        active_player['commodities'][demand] = active_player['commodities'].get(demand, 0) + 1
    else:
        active_player['resources'][demand] = active_player['resources'].get(demand, 0) + 1
        if room['bank']:
            room['bank'][demand] -= 1

    room['gameLog'].append(f"{active_player['username']} traded {req_ratio} {offer} for 1 {demand} with the Bank.")

    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('submitDiscard')
async def on_submit_discard(sid, discarded_cards):
    room, slot = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'discard':
        return

    if slot['index'] not in room['discardsPending']:
        return

    cards_to_discard = room['discardsPending'][slot['index']]
    commodity_picks = discarded_cards.get('commodities', {}) if isinstance(discarded_cards, dict) else {}
    submitted_total = 0
    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        amt = int(discarded_cards.get(res, 0))
        if amt < 0 or slot['resources'].get(res, 0) < amt:
            await sio.emit('errorMsg', 'Invalid discard selection.', to=sid)
            return
        submitted_total += amt
    for com in ['coin', 'cloth', 'paper']:
        amt = int(commodity_picks.get(com, 0))
        if amt < 0 or slot.get('commodities', {}).get(com, 0) < amt:
            await sio.emit('errorMsg', 'Invalid discard selection.', to=sid)
            return
        submitted_total += amt

    if submitted_total != cards_to_discard:
        await sio.emit('errorMsg', f"Must discard exactly {cards_to_discard} cards.", to=sid)
        return

    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        amt = int(discarded_cards.get(res, 0))
        slot['resources'][res] -= amt
        if room['bank']:
            room['bank'][res] = min(19, room['bank'][res] + amt)
    for com in ['coin', 'cloth', 'paper']:
        amt = int(commodity_picks.get(com, 0))
        if amt:
            slot['commodities'][com] -= amt

    room['gameLog'].append(f"{slot['username']} discarded {cards_to_discard} cards.")
    room['discardsPending'].pop(slot['index'], None)

    if not room['discardsPending']:
        room['gameState'] = 'robberMove'

    await broadcast_game_state(room)

    if room['gameState'] == 'robberMove':
        schedule_bot_action(room['code'])

@sio.on('moveRobber')
async def on_move_robber(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'robberMove':
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    q = int(data['q'])
    r = int(data['r'])
    hex_tile = next((h for h in room['board']['hexes'] if h['q'] == q and h['r'] == r), None)
    if not hex_tile or hex_tile['resource'] == 'water':
        await sio.emit('errorMsg', 'Must place the Robber on a land hex.', to=sid)
        return

    if room['robberHex'] and room['robberHex']['q'] == q and room['robberHex']['r'] == r:
        await sio.emit('errorMsg', 'Must move the Robber to a different hex.', to=sid)
        return

    # Determine adjacent players who have resources to steal
    adjacent_players = []
    for v_id in hex_tile['vertices']:
        v = room['board']['vertices'][v_id]
        if v['owner'] is not None and v['owner'] != active_player['index']:
            owner_slot = room['slots'][v['owner']]
            if owner_slot and owner_slot['type'] != 'empty':
                total_res = sum(owner_slot['resources'].values())
                if total_res > 0 and owner_slot['index'] not in adjacent_players:
                    adjacent_players.append(owner_slot['index'])

    bishop = bool(room.get('bishopActive'))
    target_idx = None
    if not bishop:
        if len(adjacent_players) > 1:
            req_target = data.get('targetPlayerIndex')
            if req_target is not None and int(req_target) in adjacent_players:
                target_idx = int(req_target)
            else:
                await sio.emit('errorMsg', 'Multiple adjacent opponents. You must select who to steal from.', to=sid)
                return
        elif len(adjacent_players) == 1:
            target_idx = adjacent_players[0]

    # Commit Robber Position and return state
    room['robberHex'] = { 'q': q, 'r': r }
    room['gameLog'].append(f"{active_player['username']} moved the Robber.")

    if 'robberReturnState' in room and room['robberReturnState']:
        room['gameState'] = room['robberReturnState']['state']
        room['diceRolled'] = room['robberReturnState']['diceRolled']
        room['robberReturnState'] = None
    else:
        room['gameState'] = 'playing'
        room['diceRolled'] = True

    resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
    if bishop:
        # Bishop progress card: steal 1 random card from every adjacent opponent.
        room['bishopActive'] = False
        for idx in adjacent_players:
            tslot = room['slots'][idx]
            available = [res for res in resources if tslot['resources'].get(res, 0) > 0]
            if available:
                stolen = random.choice(available)
                tslot['resources'][stolen] -= 1
                active_player['resources'][stolen] = active_player['resources'].get(stolen, 0) + 1
                room['gameLog'].append(f"{active_player['username']} stole 1 card from {tslot['username']} (Bishop).")
    elif target_idx is not None:
        target_slot = room['slots'][target_idx]
        available = [res for res in resources if target_slot['resources'].get(res, 0) > 0]
        if available:
            stolen = random.choice(available)
            target_slot['resources'][stolen] -= 1
            active_player['resources'][stolen] = active_player['resources'].get(stolen, 0) + 1
            room['gameLog'].append(f"{active_player['username']} stole 1 card from {target_slot['username']}.")

    await broadcast_game_state(room)
    schedule_bot_action(room['code'])

@sio.on('movePirate')
async def on_move_pirate(sid, data):
    # Seafarers: on a 7 the active player may move the Pirate (sea) instead of the Robber.
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'robberMove' or room['gameMode'] != 'seafarers':
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    q = int(data['q'])
    r = int(data['r'])
    hex_tile = _hex_at(room, q, r)
    if not hex_tile or hex_tile['resource'] != 'water':
        await sio.emit('errorMsg', 'The Pirate must be placed on a sea hex.', to=sid)
        return
    if room.get('pirateHex') and room['pirateHex']['q'] == q and room['pirateHex']['r'] == r:
        await sio.emit('errorMsg', 'Must move the Pirate to a different hex.', to=sid)
        return

    # Steal from opponents who have a ship on an edge of this sea hex
    adjacent_players = []
    for e in room['board']['edges']:
        if e['id'] in hex_tile['edges'] and e['owner'] is not None and e['owner'] != active_player['index'] and e.get('type') == 'ship':
            owner_slot = room['slots'][e['owner']]
            if owner_slot and owner_slot['type'] != 'empty':
                total_res = sum(owner_slot['resources'].values())
                if total_res > 0 and owner_slot['index'] not in adjacent_players:
                    adjacent_players.append(owner_slot['index'])

    target_idx = None
    if len(adjacent_players) > 1:
        req_target = data.get('targetPlayerIndex')
        if req_target is not None and int(req_target) in adjacent_players:
            target_idx = int(req_target)
        else:
            await sio.emit('errorMsg', 'Multiple opponents with adjacent ships. You must select who to steal from.', to=sid)
            return
    elif len(adjacent_players) == 1:
        target_idx = adjacent_players[0]

    room['pirateHex'] = {'q': q, 'r': r}
    room['gameLog'].append(f"{active_player['username']} moved the Pirate.")

    if 'robberReturnState' in room and room['robberReturnState']:
        room['gameState'] = room['robberReturnState']['state']
        room['diceRolled'] = room['robberReturnState']['diceRolled']
        room['robberReturnState'] = None
    else:
        room['gameState'] = 'playing'
        room['diceRolled'] = True

    if target_idx is not None:
        target_slot = room['slots'][target_idx]
        available = [res for res in ['wood', 'brick', 'sheep', 'wheat', 'ore'] if target_slot['resources'].get(res, 0) > 0]
        if available:
            stolen = random.choice(available)
            target_slot['resources'][stolen] -= 1
            active_player['resources'][stolen] = active_player['resources'].get(stolen, 0) + 1
            room['gameLog'].append(f"{active_player['username']} stole 1 card from {target_slot['username']}.")

    await broadcast_game_state(room)
    schedule_bot_action(room['code'])

@sio.on('chooseGold')
async def on_choose_gold(sid, data):
    # Seafarers: a player resolves resources owed by a Gold field.
    room, slot = await get_session_room_and_slot(sid)
    if not room or room.get('gameState') != 'goldChoice':
        return
    if slot['index'] not in room.get('goldPending', {}):
        return

    count = room['goldPending'][slot['index']]
    picks = data.get('picks', {}) if isinstance(data, dict) else {}
    total = 0
    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        amt = int(picks.get(res, 0))
        if amt < 0:
            await sio.emit('errorMsg', 'Invalid selection.', to=sid)
            return
        if room['bank'] and room['bank'].get(res, 0) < amt:
            await sio.emit('errorMsg', f'The Bank does not have enough {res}.', to=sid)
            return
        total += amt
    if total != count:
        await sio.emit('errorMsg', f'You must pick exactly {count} resource(s).', to=sid)
        return

    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        amt = int(picks.get(res, 0))
        if amt:
            slot['resources'][res] = slot['resources'].get(res, 0) + amt
            if room['bank']:
                room['bank'][res] -= amt
    room['goldPending'].pop(slot['index'], None)
    room['gameLog'].append(f"{slot['username']} chose {count} resource(s) from a Gold field.")

    if not room['goldPending']:
        room['gameState'] = room.get('goldReturnState') or 'playing'
        room['goldReturnState'] = None
        await broadcast_game_state(room)
        schedule_bot_action(room['code'])
    else:
        await broadcast_game_state(room)

@sio.on('buildShip')
async def on_build_ship(sid, edge_id):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameMode'] != 'seafarers':
        return
    if room['gameState'] != 'playing' or not room['diceRolled']:
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    ships_count = len([e for e in room['board']['edges'] if e['owner'] == active_player['index'] and e.get('type') == 'ship'])
    if ships_count >= 15:
        await sio.emit('errorMsg', 'You have reached the limit of 15 Ships.', to=sid)
        return

    edge = next((e for e in room['board']['edges'] if e['id'] == edge_id), None)
    if not edge or edge['owner'] is not None:
        await sio.emit('errorMsg', 'Invalid path.', to=sid)
        return
    if not edge.get('sea'):
        await sio.emit('errorMsg', 'Ships can only be built on sea edges.', to=sid)
        return
    if room.get('pirateHex') and _edge_touches_hex(room, edge, room['pirateHex']):
        await sio.emit('errorMsg', 'The Pirate blocks building a ship here.', to=sid)
        return

    r = active_player['resources']
    if r.get('wood', 0) < 1 or r.get('sheep', 0) < 1:
        await sio.emit('errorMsg', 'Insufficient resources. A Ship costs 1 Wood and 1 Sheep.', to=sid)
        return

    if not is_ship_connection_valid(room['board'], edge, active_player['index']):
        await sio.emit('errorMsg', 'Ships must extend from a coastal settlement/city or another of your ships.', to=sid)
        return

    r['wood'] -= 1; r['sheep'] -= 1
    if room['bank']:
        room['bank']['wood'] = min(19, room['bank']['wood'] + 1)
        room['bank']['sheep'] = min(19, room['bank']['sheep'] + 1)

    edge['owner'] = active_player['index']
    edge['type'] = 'ship'
    edge['builtThisTurn'] = True
    room['gameLog'].append(f"{active_player['username']} built a ship.")

    check_longest_road(room)
    check_road_victory(room)
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('moveShip')
async def on_move_ship(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameMode'] != 'seafarers':
        return
    if room['gameState'] != 'playing' or not room['diceRolled']:
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if room.get('shipMovedThisTurn'):
        await sio.emit('errorMsg', 'You can only move one ship per turn.', to=sid)
        return

    from_id = data.get('from')
    to_id = data.get('to')
    from_edge = next((e for e in room['board']['edges'] if e['id'] == from_id), None)
    to_edge = next((e for e in room['board']['edges'] if e['id'] == to_id), None)

    if not from_edge or from_edge['owner'] != active_player['index'] or from_edge.get('type') != 'ship':
        await sio.emit('errorMsg', 'Select one of your ships to move.', to=sid)
        return
    if from_edge.get('builtThisTurn'):
        await sio.emit('errorMsg', 'You cannot move a ship you built this turn.', to=sid)
        return
    if not is_ship_open_ended(room['board'], from_edge, active_player['index']):
        await sio.emit('errorMsg', 'Only a ship at the open end of a route can be moved.', to=sid)
        return
    if not to_edge or to_edge['owner'] is not None or not to_edge.get('sea'):
        await sio.emit('errorMsg', 'Invalid destination for the ship.', to=sid)
        return

    # Detach the ship, then verify the destination still connects to the network.
    prev_type = from_edge['type']
    from_edge['owner'] = None
    from_edge['type'] = None
    valid = is_ship_connection_valid(room['board'], to_edge, active_player['index'])
    if valid and room.get('pirateHex') and _edge_touches_hex(room, to_edge, room['pirateHex']):
        valid = False
    if not valid:
        from_edge['owner'] = active_player['index']
        from_edge['type'] = prev_type
        await sio.emit('errorMsg', 'The ship must still connect to your network.', to=sid)
        return

    to_edge['owner'] = active_player['index']
    to_edge['type'] = 'ship'
    to_edge['builtThisTurn'] = True
    room['shipMovedThisTurn'] = True
    room['gameLog'].append(f"{active_player['username']} moved a ship.")

    check_longest_road(room)
    check_road_victory(room)
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('upgradeCityImprovement')
async def on_upgrade_city_improvement(sid, data):
    # Cities & Knights: spend commodities to advance one of the 3 city-improvement
    # tracks. Cost to reach level n = n commodities of that track's type.
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameMode'] != 'cities':
        return
    if room['gameState'] != 'playing' or not room['diceRolled']:
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    track = data.get('track') if isinstance(data, dict) else None
    if track not in IMPROVEMENT_COMMODITY:
        await sio.emit('errorMsg', 'Invalid improvement track.', to=sid)
        return

    current = active_player['improvements'].get(track, 0)
    if current >= 5:
        await sio.emit('errorMsg', 'That improvement is already at the maximum level.', to=sid)
        return

    cities_owned = len([v for v in room['board']['vertices'] if v['owner'] == active_player['index'] and v['building'] == 'city'])
    if cities_owned < 1:
        await sio.emit('errorMsg', 'You need at least one city to build city improvements.', to=sid)
        return

    com = IMPROVEMENT_COMMODITY[track]
    cost = current + 1
    crane = bool(active_player.get('craneDiscount'))
    if crane:
        cost = max(0, cost - 1)  # Crane progress card: 1 fewer commodity
    if active_player['commodities'].get(com, 0) < cost:
        await sio.emit('errorMsg', f'That upgrade costs {cost} {com}.', to=sid)
        return

    active_player['commodities'][com] -= cost
    if crane:
        active_player['craneDiscount'] = False
    new_level = current + 1
    active_player['improvements'][track] = new_level
    room['gameLog'].append(f"{active_player['username']} advanced {track.capitalize()} to level {new_level}.")

    # Reaching level 4 claims the discipline's Metropolis; level 5 can seize it
    # from a level-4 holder and protects your own.
    award_metropolis(room, active_player, track)

    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('buildCityWall')
async def on_build_city_wall(sid):
    # Cities & Knights: a City Wall (2 brick) raises your hand limit by 2, one per city (max 3).
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameMode'] != 'cities':
        return
    if room['gameState'] != 'playing' or not room['diceRolled']:
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    cities_owned = len([v for v in room['board']['vertices'] if v['owner'] == active_player['index'] and v['building'] == 'city'])
    if active_player.get('cityWalls', 0) >= min(3, cities_owned):
        await sio.emit('errorMsg', 'You have no city that can take another wall.', to=sid)
        return

    r = active_player['resources']
    if r.get('brick', 0) < 2:
        await sio.emit('errorMsg', 'A City Wall costs 2 Brick.', to=sid)
        return
    r['brick'] -= 2
    if room['bank']:
        room['bank']['brick'] = min(19, room['bank']['brick'] + 2)
    active_player['cityWalls'] = active_player.get('cityWalls', 0) + 1
    room['gameLog'].append(f"{active_player['username']} built a City Wall (hand limit +2).")

    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

def _cities_turn_guard(room, active_player):
    """Common precondition for Cities & Knights build actions on your own turn."""
    if not room or room['gameMode'] != 'cities':
        return 'wrong-mode'
    if room['gameState'] != 'playing' or not room['diceRolled']:
        return 'wrong-state'
    if room['currentPlayerIndex'] != active_player['index']:
        return 'not-your-turn'
    return None

@sio.on('buildKnight')
async def on_build_knight(sid, raw_vertex_id):
    # Place a new basic (level 1) knight on an empty intersection in your network.
    room, active_player = await get_session_room_and_slot(sid)
    guard = _cities_turn_guard(room, active_player) if room else 'wrong-mode'
    if guard == 'not-your-turn':
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if guard:
        return

    if len(player_knights(room, active_player['index'])) >= KNIGHT_MAX_TOTAL:
        await sio.emit('errorMsg', f'You already have the maximum of {KNIGHT_MAX_TOTAL} knights.', to=sid)
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    if not vertex_is_free(vertex):
        await sio.emit('errorMsg', 'That intersection is already occupied.', to=sid)
        return
    if not vertex_road_connected(room['board'], vertex_id, active_player['index']):
        await sio.emit('errorMsg', 'A knight must be placed on your road network.', to=sid)
        return

    r = active_player['resources']
    if r.get('ore', 0) < 1 or r.get('sheep', 0) < 1:
        await sio.emit('errorMsg', 'A Knight costs 1 Ore and 1 Sheep.', to=sid)
        return
    r['ore'] -= 1; r['sheep'] -= 1
    if room['bank']:
        room['bank']['ore'] = min(19, room['bank']['ore'] + 1)
        room['bank']['sheep'] = min(19, room['bank']['sheep'] + 1)

    vertex['knight'] = {'owner': active_player['index'], 'level': 1, 'active': False,
                        'builtThisTurn': True, 'actedThisTurn': False}
    room['gameLog'].append(f"{active_player['username']} recruited a Knight.")
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('activateKnight')
async def on_activate_knight(sid, raw_vertex_id):
    # Activate one of your inactive knights for 1 Wheat (not on the turn it was built).
    room, active_player = await get_session_room_and_slot(sid)
    guard = _cities_turn_guard(room, active_player) if room else 'wrong-mode'
    if guard == 'not-your-turn':
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if guard:
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    k = vertex.get('knight')
    if not k or k['owner'] != active_player['index']:
        await sio.emit('errorMsg', 'That is not your knight.', to=sid)
        return
    if k['active']:
        await sio.emit('errorMsg', 'That knight is already active.', to=sid)
        return
    if k.get('builtThisTurn'):
        await sio.emit('errorMsg', 'You cannot activate a knight the turn you built it.', to=sid)
        return
    if active_player['resources'].get('wheat', 0) < 1:
        await sio.emit('errorMsg', 'Activating a knight costs 1 Wheat.', to=sid)
        return
    active_player['resources']['wheat'] -= 1
    if room['bank']:
        room['bank']['wheat'] = min(19, room['bank']['wheat'] + 1)
    k['active'] = True
    room['gameLog'].append(f"{active_player['username']} activated a Knight.")
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('promoteKnight')
async def on_promote_knight(sid, raw_vertex_id):
    # Promote a knight one level (1->2 or 2->3). Reaching level 3 needs Politics >= 3.
    room, active_player = await get_session_room_and_slot(sid)
    guard = _cities_turn_guard(room, active_player) if room else 'wrong-mode'
    if guard == 'not-your-turn':
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if guard:
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    k = vertex.get('knight')
    if not k or k['owner'] != active_player['index']:
        await sio.emit('errorMsg', 'That is not your knight.', to=sid)
        return
    if k['level'] >= 3:
        await sio.emit('errorMsg', 'That knight is already at the maximum level.', to=sid)
        return
    new_level = k['level'] + 1
    if new_level == 3 and active_player['improvements'].get('politics', 0) < 3:
        await sio.emit('errorMsg', 'Promoting to a Mighty Knight requires Politics level 3.', to=sid)
        return
    at_new_level = sum(1 for v in player_knights(room, active_player['index']) if v['knight']['level'] == new_level)
    if at_new_level >= KNIGHT_MAX_PER_LEVEL:
        await sio.emit('errorMsg', f'You already have {KNIGHT_MAX_PER_LEVEL} knights at that level.', to=sid)
        return
    r = active_player['resources']
    if r.get('ore', 0) < 1 or r.get('sheep', 0) < 1:
        await sio.emit('errorMsg', 'Promoting a knight costs 1 Ore and 1 Sheep.', to=sid)
        return
    r['ore'] -= 1; r['sheep'] -= 1
    if room['bank']:
        room['bank']['ore'] = min(19, room['bank']['ore'] + 1)
        room['bank']['sheep'] = min(19, room['bank']['sheep'] + 1)
    k['level'] = new_level
    room['gameLog'].append(f"{active_player['username']} promoted a Knight to level {new_level}.")
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('moveKnight')
async def on_move_knight(sid, data):
    # Move an active knight along your network to an empty intersection, or onto a
    # weaker enemy knight to displace it. The knight is deactivated afterwards.
    room, active_player = await get_session_room_and_slot(sid)
    guard = _cities_turn_guard(room, active_player) if room else 'wrong-mode'
    if guard == 'not-your-turn':
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if guard:
        return

    from_v = int(data.get('from'))
    to_v = int(data.get('to'))
    vertices = room['board']['vertices']
    src = vertices[from_v]
    k = src.get('knight')
    if not k or k['owner'] != active_player['index']:
        await sio.emit('errorMsg', 'That is not your knight.', to=sid)
        return
    if not k['active']:
        await sio.emit('errorMsg', 'Only an active knight can move.', to=sid)
        return
    if k.get('actedThisTurn'):
        await sio.emit('errorMsg', 'That knight has already acted this turn.', to=sid)
        return

    if to_v not in knight_reachable_vertices(room['board'], from_v, active_player['index']):
        await sio.emit('errorMsg', 'That knight cannot reach there along your roads.', to=sid)
        return

    dest = vertices[to_v]
    dest_knight = dest.get('knight')
    if dest['owner'] is not None:
        await sio.emit('errorMsg', 'A settlement or city is in the way.', to=sid)
        return
    if dest_knight:
        # Displacement: must be a weaker enemy knight
        if dest_knight['owner'] == active_player['index']:
            await sio.emit('errorMsg', 'One of your own knights is already there.', to=sid)
            return
        if dest_knight['level'] >= k['level']:
            await sio.emit('errorMsg', 'You can only displace a weaker knight.', to=sid)
            return
        displaced = dest_knight
        # Relocate the displaced knight to an empty vertex on its owner's network
        relocated = False
        for cand in knight_reachable_vertices(room['board'], to_v, displaced['owner']):
            if vertex_is_free(vertices[cand]):
                vertices[cand]['knight'] = displaced
                relocated = True
                break
        if not relocated:
            room['gameLog'].append(f"{room['slots'][displaced['owner']]['username']}'s displaced Knight had nowhere to go and was removed.")
        else:
            room['gameLog'].append(f"{active_player['username']} displaced {room['slots'][displaced['owner']]['username']}'s Knight.")

    # Perform the move
    dest['knight'] = k
    src['knight'] = None
    k['active'] = False
    k['actedThisTurn'] = True
    room['gameLog'].append(f"{active_player['username']} moved a Knight.")
    check_longest_road(room)
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('chaseRobber')
async def on_chase_robber(sid, raw_vertex_id):
    # An active knight adjacent to the Robber can chase it away, letting its owner
    # move the Robber (and steal) this turn. The knight is deactivated.
    room, active_player = await get_session_room_and_slot(sid)
    guard = _cities_turn_guard(room, active_player) if room else 'wrong-mode'
    if guard == 'not-your-turn':
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return
    if guard:
        return

    vertex_id = int(raw_vertex_id)
    vertex = room['board']['vertices'][vertex_id]
    k = vertex.get('knight')
    if not k or k['owner'] != active_player['index'] or not k['active']:
        await sio.emit('errorMsg', 'You need an active knight for that.', to=sid)
        return
    if k.get('actedThisTurn'):
        await sio.emit('errorMsg', 'That knight has already acted this turn.', to=sid)
        return
    robber = room.get('robberHex')
    robber_hex = _hex_at(room, robber['q'], robber['r']) if robber else None
    if not robber_hex or vertex_id not in robber_hex['vertices']:
        await sio.emit('errorMsg', 'That knight is not next to the Robber.', to=sid)
        return

    k['active'] = False
    k['actedThisTurn'] = True
    room['robberReturnState'] = {'state': 'playing', 'diceRolled': room['diceRolled']}
    room['gameState'] = 'robberMove'
    room['gameLog'].append(f"{active_player['username']}'s Knight chased the Robber away!")
    await broadcast_game_state(room)

# All 23 non-VP progress cards are playable. (Constitution/Printer are the VP
# cards, auto-resolved on draw.)
IMPLEMENTED_PROGRESS_CARDS = {
    'Alchemist', 'Road Building', 'Smith', 'Irrigation', 'Mining', 'Engineer',
    'Crane', 'Medicine', 'Warlord', 'Saboteur', 'Resource Monopoly',
    'Trade Monopoly', 'Merchant Fleet', 'Inventor', 'Bishop', 'Deserter',
    'Diplomat', 'Intrigue', 'Spy', 'Wedding', 'Master Merchant',
    'Commercial Harbor', 'Merchant',
}

@sio.on('playProgressCard')
async def on_play_progress_card(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameMode'] != 'cities' or room['gameState'] != 'playing':
        return
    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    card = data.get('card') if isinstance(data, dict) else None
    if not card or card not in active_player.get('progressCards', []):
        await sio.emit('errorMsg', 'You do not have that progress card.', to=sid)
        return
    if card not in IMPLEMENTED_PROGRESS_CARDS:
        await sio.emit('errorMsg', 'That progress card is not playable yet.', to=sid)
        return
    # Every card except Alchemist is played during the build phase (after rolling).
    if card != 'Alchemist' and not room['diceRolled']:
        await sio.emit('errorMsg', 'Roll the dice first.', to=sid)
        return

    resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
    commodities = ['coin', 'cloth', 'paper']
    err = None

    if card == 'Alchemist':
        if room['diceRolled']:
            err = 'Alchemist must be played before you roll.'
        else:
            try:
                d1 = int(data.get('d1')); d2 = int(data.get('d2'))
            except (TypeError, ValueError):
                d1 = d2 = 0
            if not (1 <= d1 <= 6 and 1 <= d2 <= 6):
                err = 'Choose two dice values from 1 to 6.'
            else:
                room['forcedDice'] = [d1, d2]
                room['gameLog'].append(f"{active_player['username']} played Alchemist and set the dice to {d1} + {d2}.")

    elif card == 'Road Building':
        room['roadBuildingState'] = {'roadsRemaining': 2, 'playerIndex': active_player['index']}
        room['roadBuildingReturnState'] = {'state': 'playing', 'diceRolled': room['diceRolled']}
        room['gameState'] = 'roadBuilding'
        room['gameLog'].append(f"{active_player['username']} played Road Building (2 free roads).")

    elif card == 'Smith':
        promoted = 0
        for v in player_knights(room, active_player['index']):
            if promoted >= 2:
                break
            k = v['knight']
            if k['level'] >= 3:
                continue
            new_level = k['level'] + 1
            if new_level == 3 and active_player['improvements'].get('politics', 0) < 3:
                continue
            at_new = sum(1 for vv in player_knights(room, active_player['index']) if vv['knight']['level'] == new_level)
            if at_new >= KNIGHT_MAX_PER_LEVEL:
                continue
            k['level'] = new_level
            promoted += 1
        if promoted == 0:
            err = 'No knights could be promoted.'
        else:
            room['gameLog'].append(f"{active_player['username']} played Smith and promoted {promoted} knight(s) for free.")

    elif card in ('Irrigation', 'Mining'):
        terrain = 'wheat' if card == 'Irrigation' else 'ore'
        my_hexes = set()
        for h in room['board']['hexes']:
            if h['resource'] != terrain:
                continue
            for vid in h['vertices']:
                v = room['board']['vertices'][vid]
                if v['owner'] == active_player['index'] and v['building'] in ('settlement', 'city'):
                    my_hexes.add((h['q'], h['r']))
                    break
        gain = 2 * len(my_hexes)
        if gain == 0:
            err = f'You have no buildings next to a {terrain} hex.'
        else:
            active_player['resources'][terrain] = active_player['resources'].get(terrain, 0) + gain
            if room['bank']:
                room['bank'][terrain] = max(0, room['bank'][terrain] - gain)
            room['gameLog'].append(f"{active_player['username']} played {card} and gained {gain} {terrain}.")

    elif card == 'Engineer':
        cities_owned = len([v for v in room['board']['vertices'] if v['owner'] == active_player['index'] and v['building'] == 'city'])
        if active_player.get('cityWalls', 0) >= min(3, cities_owned):
            err = 'You have no city that can take another wall.'
        else:
            active_player['cityWalls'] = active_player.get('cityWalls', 0) + 1
            room['gameLog'].append(f"{active_player['username']} played Engineer and built a free City Wall.")

    elif card == 'Crane':
        active_player['craneDiscount'] = True
        room['gameLog'].append(f"{active_player['username']} played Crane — the next city improvement costs 1 less commodity.")

    elif card == 'Medicine':
        active_player['medicineDiscount'] = True
        room['gameLog'].append(f"{active_player['username']} played Medicine — the next city upgrade costs 2 Ore + 1 Wheat.")

    elif card == 'Warlord':
        n = 0
        for v in player_knights(room, active_player['index']):
            if not v['knight']['active']:
                v['knight']['active'] = True
                n += 1
        room['gameLog'].append(f"{active_player['username']} played Warlord and activated {n} knight(s).")

    elif card == 'Saboteur':
        my_vp = active_player['victoryPoints']
        for s in room['slots']:
            if s['type'] == 'empty' or s['index'] == active_player['index']:
                continue
            if s['victoryPoints'] >= my_vp:
                n = hand_size(s) // 2
                if n > 0:
                    discard_random_cards(room, s, n)
                    room['gameLog'].append(f"{s['username']} lost {n} card(s) to the Saboteur.")
        room['gameLog'].append(f"{active_player['username']} played Saboteur.")

    elif card == 'Resource Monopoly':
        res = data.get('resource')
        if res not in resources:
            err = 'Choose a resource for Resource Monopoly.'
        else:
            taken = 0
            for s in room['slots']:
                if s['type'] != 'empty' and s['index'] != active_player['index']:
                    amt = min(2, s['resources'].get(res, 0))
                    if amt:
                        s['resources'][res] -= amt
                        taken += amt
            active_player['resources'][res] = active_player['resources'].get(res, 0) + taken
            room['gameLog'].append(f"{active_player['username']} played Resource Monopoly on {res} and took {taken}.")

    elif card == 'Trade Monopoly':
        com = data.get('commodity')
        if com not in commodities:
            err = 'Choose a commodity for Trade Monopoly.'
        else:
            taken = 0
            for s in room['slots']:
                if s['type'] != 'empty' and s['index'] != active_player['index']:
                    amt = min(1, s['commodities'].get(com, 0))
                    if amt:
                        s['commodities'][com] -= amt
                        taken += amt
            active_player['commodities'][com] = active_player['commodities'].get(com, 0) + taken
            room['gameLog'].append(f"{active_player['username']} played Trade Monopoly on {com} and took {taken}.")

    elif card == 'Merchant Fleet':
        kind = data.get('resource')
        if kind not in resources:
            err = 'Choose a resource for Merchant Fleet.'
        else:
            active_player['merchantFleet'] = kind
            room['gameLog'].append(f"{active_player['username']} played Merchant Fleet (2:1 on {kind} this turn).")

    elif card == 'Inventor':
        h1 = data.get('hex1') or {}
        h2 = data.get('hex2') or {}
        t1 = _hex_at(room, int(h1['q']), int(h1['r'])) if 'q' in h1 else None
        t2 = _hex_at(room, int(h2['q']), int(h2['r'])) if 'q' in h2 else None
        if not t1 or not t2 or t1 is t2 or t1['number'] is None or t2['number'] is None:
            err = 'Pick two different numbered land hexes.'
        elif t1['number'] in (2, 6, 8, 12) or t2['number'] in (2, 6, 8, 12):
            err = 'Inventor cannot move the 2, 6, 8 or 12 tokens.'
        else:
            t1['number'], t2['number'] = t2['number'], t1['number']
            room['gameLog'].append(f"{active_player['username']} played Inventor and swapped two number tokens.")

    elif card == 'Bishop':
        room['bishopActive'] = True
        room['robberReturnState'] = {'state': 'playing', 'diceRolled': room['diceRolled']}
        room['gameState'] = 'robberMove'
        room['gameLog'].append(f"{active_player['username']} played Bishop — move the Robber and rob every neighbour.")

    elif card == 'Spy':
        try:
            target = int(data.get('target'))
        except (TypeError, ValueError):
            target = -1
        want = data.get('progressCard')
        tslot = room['slots'][target] if 0 <= target < len(room['slots']) else None
        if not tslot or tslot['type'] == 'empty' or target == active_player['index']:
            err = 'Choose an opponent to spy on.'
        elif want not in tslot.get('progressCards', []):
            err = 'That opponent does not have that progress card.'
        else:
            tslot['progressCards'].remove(want)
            active_player.setdefault('progressCards', []).append(want)
            room['gameLog'].append(f"{active_player['username']} played Spy and stole a progress card from {tslot['username']}.")

    elif card == 'Wedding':
        my_vp = active_player['victoryPoints']
        for s in room['slots']:
            if s['type'] == 'empty' or s['index'] == active_player['index'] or s['victoryPoints'] <= my_vp:
                continue
            for _ in range(2):
                hand = [('r', r) for r in resources for _ in range(s['resources'].get(r, 0))]
                hand += [('c', c) for c in commodities for _ in range(s['commodities'].get(c, 0))]
                if not hand:
                    break
                kind, name = random.choice(hand)
                bucket = 'resources' if kind == 'r' else 'commodities'
                s[bucket][name] -= 1
                active_player[bucket][name] = active_player[bucket].get(name, 0) + 1
            room['gameLog'].append(f"{s['username']} gave up to 2 cards to {active_player['username']} (Wedding).")

    elif card == 'Master Merchant':
        try:
            target = int(data.get('target'))
        except (TypeError, ValueError):
            target = -1
        tslot = room['slots'][target] if 0 <= target < len(room['slots']) else None
        if not tslot or tslot['type'] == 'empty' or target == active_player['index']:
            err = 'Choose an opponent for Master Merchant.'
        elif tslot['victoryPoints'] < active_player['victoryPoints']:
            err = 'Master Merchant targets a player with at least as many points as you.'
        else:
            taken = 0
            for _ in range(2):
                hand = [('r', r) for r in resources for _ in range(tslot['resources'].get(r, 0))]
                hand += [('c', c) for c in commodities for _ in range(tslot['commodities'].get(c, 0))]
                if not hand:
                    break
                kind, name = random.choice(hand)
                bucket = 'resources' if kind == 'r' else 'commodities'
                tslot[bucket][name] -= 1
                active_player[bucket][name] = active_player[bucket].get(name, 0) + 1
                taken += 1
            room['gameLog'].append(f"{active_player['username']} played Master Merchant and took {taken} cards from {tslot['username']}.")

    elif card == 'Commercial Harbor':
        swaps = 0
        for s in room['slots']:
            if s['type'] == 'empty' or s['index'] == active_player['index']:
                continue
            my_coms = [c for c in commodities if active_player['commodities'].get(c, 0) > 0]
            their_res = [r for r in resources if s['resources'].get(r, 0) > 0]
            if my_coms and their_res:
                give = random.choice(my_coms)
                take = random.choice(their_res)
                active_player['commodities'][give] -= 1
                s['commodities'][give] = s['commodities'].get(give, 0) + 1
                s['resources'][take] -= 1
                active_player['resources'][take] = active_player['resources'].get(take, 0) + 1
                swaps += 1
        if swaps == 0:
            err = 'No opponent could trade a resource for one of your commodities.'
        else:
            room['gameLog'].append(f"{active_player['username']} played Commercial Harbor ({swaps} forced trade(s)).")

    elif card == 'Merchant':
        try:
            q = int(data.get('q')); r = int(data.get('r'))
        except (TypeError, ValueError):
            q = r = None
        hex_tile = _hex_at(room, q, r) if q is not None else None
        if not hex_tile or hex_tile['resource'] in ('water', 'desert', 'gold'):
            err = 'Place the Merchant on a resource land hex.'
        elif not any(room['board']['vertices'][vid]['owner'] == active_player['index'] and room['board']['vertices'][vid]['building'] in ('settlement', 'city') for vid in hex_tile['vertices']):
            err = 'The Merchant must be placed next to your settlement or city.'
        else:
            prev = room.get('merchant')
            if prev and prev.get('owner') is not None and prev['owner'] != active_player['index']:
                room['slots'][prev['owner']]['victoryPoints'] = max(0, room['slots'][prev['owner']]['victoryPoints'] - 1)
            if not prev or prev.get('owner') != active_player['index']:
                active_player['victoryPoints'] += 1
            room['merchant'] = {'owner': active_player['index'], 'q': q, 'r': r, 'resource': hex_tile['resource']}
            room['gameLog'].append(f"{active_player['username']} played Merchant on a {hex_tile['resource']} hex (2:1 trade + 1 VP).")

    elif card == 'Deserter':
        try:
            tv = int(data.get('targetVertex')); pv = int(data.get('placeVertex'))
        except (TypeError, ValueError):
            tv = pv = -1
        verts = room['board']['vertices']
        tvert = verts[tv] if 0 <= tv < len(verts) else None
        pvert = verts[pv] if 0 <= pv < len(verts) else None
        ek = tvert.get('knight') if tvert else None
        if not ek or ek['owner'] == active_player['index']:
            err = "Choose an opponent's knight to make desert."
        elif len(player_knights(room, active_player['index'])) >= KNIGHT_MAX_TOTAL:
            err = 'You already have the maximum number of knights.'
        elif not pvert or not vertex_is_free(pvert) or not vertex_road_connected(room['board'], pv, active_player['index']):
            err = 'Choose an empty spot on your road network for the deserted knight.'
        else:
            level = ek['level']
            tvert['knight'] = None
            pvert['knight'] = {'owner': active_player['index'], 'level': level, 'active': False, 'builtThisTurn': True, 'actedThisTurn': False}
            room['gameLog'].append(f"{active_player['username']} played Deserter and took a level {level} knight from {room['slots'][ek['owner']]['username']}.")

    elif card == 'Intrigue':
        try:
            tv = int(data.get('targetVertex'))
        except (TypeError, ValueError):
            tv = -1
        verts = room['board']['vertices']
        tvert = verts[tv] if 0 <= tv < len(verts) else None
        ek = tvert.get('knight') if tvert else None
        on_my_road = tvert is not None and any((e['v1'] == tv or e['v2'] == tv) and e['owner'] == active_player['index'] for e in room['board']['edges'])
        if not ek or ek['owner'] == active_player['index']:
            err = "Choose an opponent's knight to displace."
        elif not on_my_road:
            err = 'Intrigue only displaces a knight standing on one of your roads.'
        else:
            relocated = False
            for cand in knight_reachable_vertices(room['board'], tv, ek['owner']):
                if vertex_is_free(verts[cand]):
                    verts[cand]['knight'] = ek
                    relocated = True
                    break
            tvert['knight'] = None
            if not relocated:
                room['gameLog'].append(f"{room['slots'][ek['owner']]['username']}'s knight was displaced with nowhere to go and removed.")
            room['gameLog'].append(f"{active_player['username']} played Intrigue and displaced {room['slots'][ek['owner']]['username']}'s knight.")

    elif card == 'Diplomat':
        eid = data.get('edge')
        edge = next((e for e in room['board']['edges'] if e['id'] == eid), None)
        if not edge or not is_open_road(room['board'], edge):
            err = 'Choose an open-ended road to remove.'
        else:
            was_mine = edge['owner'] == active_player['index']
            edge['owner'] = None
            edge['type'] = None
            check_longest_road(room)
            room['gameLog'].append(f"{active_player['username']} played Diplomat and removed an open road.")
            if was_mine:
                room['roadBuildingState'] = {'roadsRemaining': 1, 'playerIndex': active_player['index']}
                room['roadBuildingReturnState'] = {'state': 'playing', 'diceRolled': room['diceRolled']}
                room['gameState'] = 'roadBuilding'

    if err:
        await sio.emit('errorMsg', err, to=sid)
        return

    active_player['progressCards'].remove(card)
    check_victory(room, active_player)
    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)

@sio.on('playDevCard')
async def on_play_dev_card(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing':
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    card_type = data.get('cardType')
    if not card_type:
        await sio.emit('errorMsg', 'No card type specified.', to=sid)
        return

    if card_type not in active_player.get('devCards', []):
        await sio.emit('errorMsg', f"You do not have a {card_type} card to play.", to=sid)
        return

    if active_player.get('devCardPlayedThisTurn', False):
        await sio.emit('errorMsg', "You can only play one Development Card per turn.", to=sid)
        return

    success = False
    if card_type == 'Knight':
        active_player['devCards'].remove('Knight')
        active_player['knightsPlayed'] = active_player.get('knightsPlayed', 0) + 1
        active_player['devCardPlayedThisTurn'] = True
        
        room['robberReturnState'] = {
            'state': 'playing',
            'diceRolled': room['diceRolled']
        }
        room['gameState'] = 'robberMove'
        room['gameLog'].append(f"{active_player['username']} played a Knight card.")
        
        check_largest_army(room)
        check_victory(room, active_player)
        success = True

    elif card_type == 'Year of Plenty':
        resources_selected = data.get('resources', [])
        if len(resources_selected) != 2:
            await sio.emit('errorMsg', "Year of Plenty requires selecting exactly 2 resources.", to=sid)
            return
        
        for res in resources_selected:
            if room['bank'] and room['bank'].get(res, 0) < 1:
                await sio.emit('errorMsg', f"The Bank does not have enough {res}.", to=sid)
                return
                
        active_player['devCards'].remove('Year of Plenty')
        active_player['devCardPlayedThisTurn'] = True
        
        for res in resources_selected:
            active_player['resources'][res] = active_player['resources'].get(res, 0) + 1
            if room['bank']:
                room['bank'][res] -= 1
                
        room['gameLog'].append(f"{active_player['username']} played Year of Plenty and received: {', '.join(resources_selected)}.")
        check_victory(room, active_player)
        success = True

    elif card_type == 'Monopoly':
        target_res = data.get('resource')
        valid_resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
        if target_res not in valid_resources:
            await sio.emit('errorMsg', "Invalid resource selected for Monopoly.", to=sid)
            return
            
        active_player['devCards'].remove('Monopoly')
        active_player['devCardPlayedThisTurn'] = True
        
        stolen_total = 0
        for slot in room['slots']:
            if slot['type'] != 'empty' and slot['index'] != active_player['index']:
                amt = slot['resources'].get(target_res, 0)
                if amt > 0:
                    slot['resources'][target_res] = 0
                    stolen_total += amt
                    
        active_player['resources'][target_res] = active_player['resources'].get(target_res, 0) + stolen_total
        room['gameLog'].append(f"{active_player['username']} played Monopoly on {target_res}, stealing {stolen_total} cards from other players.")
        check_victory(room, active_player)
        success = True

    elif card_type == 'Road Building':
        active_player['devCards'].remove('Road Building')
        active_player['devCardPlayedThisTurn'] = True
        
        room['roadBuildingState'] = {
            'roadsRemaining': 2,
            'playerIndex': active_player['index']
        }
        room['roadBuildingReturnState'] = {
            'state': 'playing',
            'diceRolled': room['diceRolled']
        }
        room['gameState'] = 'roadBuilding'
        room['gameLog'].append(f"{active_player['username']} played Road Building (2 free roads).")
        success = True

    if success:
        await broadcast_game_state(room)
        await sio.emit('sound', 'build', to=sid)

@sio.on('endTurn')
async def on_end_turn(sid):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or not room['diceRolled']:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    advance_turn(room)
    next_player = room['slots'][room['currentPlayerIndex']]
    room['gameLog'].append(f"It is now {next_player['username']}'s turn.")

    await broadcast_game_state(room)
    schedule_bot_action(room['code'])




def schedule_bot_trade_responses(room_code):
    asyncio.create_task(run_bot_trade_responses(room_code))

async def run_bot_trade_responses(room_code):
    await asyncio.sleep(1.0)
    room = rooms.get(room_code)
    if not room or not room.get('activeTrade') or room['gameState'] in ['lobby', 'gameover']:
        return
        
    trade = room['activeTrade']
    for slot in room['slots']:
        if slot['type'] != 'empty' and slot['type'].startswith('bot') and slot['index'] != trade['proposer']:
            can_accept = True
            for res, qty in trade['demand'].items():
                if slot['resources'].get(res, 0) < qty:
                    can_accept = False
                    break
            
            if can_accept and random.random() < 0.6:
                trade['responses'][slot['index']] = {
                    'status': 'accepted',
                    'counter': None
                }
                room['gameLog'].append(f"{slot['username']} accepted the trade offer.")
                await broadcast_game_state(room)

@sio.on('proposeTrade')
async def on_propose_trade(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing' or not room['diceRolled']:
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    offer = data.get('offer', {})
    demand = data.get('demand', {})
    
    for res, qty in offer.items():
        qty = int(qty)
        if qty < 0:
            return
        if active_player['resources'].get(res, 0) < qty:
            await sio.emit('errorMsg', 'You do not have enough resources to offer this trade.', to=sid)
            return

    room['activeTrade'] = {
        'proposer': active_player['index'],
        'offer': {r: int(q) for r, q in offer.items() if int(q) > 0},
        'demand': {r: int(q) for r, q in demand.items() if int(q) > 0},
        'responses': {}
    }
    
    offer_str = ", ".join(f"{q} {r}" for r, q in room['activeTrade']['offer'].items())
    demand_str = ", ".join(f"{q} {r}" for r, q in room['activeTrade']['demand'].items())
    room['gameLog'].append(f"{active_player['username']} offered a trade: [{offer_str}] for [{demand_str}].")

    await broadcast_game_state(room)
    schedule_bot_trade_responses(room['code'])

@sio.on('acceptTrade')
async def on_accept_trade(sid):
    room, responder = await get_session_room_and_slot(sid)
    if not room or not room.get('activeTrade') or room['gameState'] != 'playing':
        return

    trade = room['activeTrade']
    if responder['index'] == trade['proposer']:
        return

    for res, qty in trade['demand'].items():
        if responder['resources'].get(res, 0) < qty:
            await sio.emit('errorMsg', 'You do not have the resources required for this trade.', to=sid)
            return

    trade['responses'][responder['index']] = {
        'status': 'accepted',
        'counter': None
    }
    room['gameLog'].append(f"{responder['username']} accepted the trade offer.")

    await broadcast_game_state(room)

@sio.on('counterTrade')
async def on_counter_trade(sid, data):
    room, responder = await get_session_room_and_slot(sid)
    if not room or not room.get('activeTrade') or room['gameState'] != 'playing':
        return

    trade = room['activeTrade']
    if responder['index'] == trade['proposer']:
        return

    counter_offer = data.get('offer', {})
    counter_demand = data.get('demand', {})

    for res, qty in counter_offer.items():
        qty = int(qty)
        if qty < 0:
            return
        if responder['resources'].get(res, 0) < qty:
            await sio.emit('errorMsg', 'You do not have the resources for this counter-offer.', to=sid)
            return

    trade['responses'][responder['index']] = {
        'status': 'counter',
        'offer': {r: int(q) for r, q in counter_offer.items() if int(q) > 0},
        'demand': {r: int(q) for r, q in counter_demand.items() if int(q) > 0}
    }
    room['gameLog'].append(f"{responder['username']} proposed a counter-offer.")

    await broadcast_game_state(room)

@sio.on('cancelTrade')
async def on_cancel_trade(sid):
    room, player = await get_session_room_and_slot(sid)
    if not room or not room.get('activeTrade'):
        return

    trade = room['activeTrade']
    if player['index'] == trade['proposer']:
        room['activeTrade'] = None
        room['gameLog'].append(f"{player['username']} cancelled the trade proposal.")
    else:
        if player['index'] in trade['responses']:
            trade['responses'].pop(player['index'])
            room['gameLog'].append(f"{player['username']} retracted their trade response.")

    await broadcast_game_state(room)

@sio.on('executeTrade')
async def on_execute_trade(sid, data):
    room, active_player = await get_session_room_and_slot(sid)
    if not room or room['gameState'] != 'playing':
        return

    if room['currentPlayerIndex'] != active_player['index']:
        await sio.emit('errorMsg', 'It is not your turn.', to=sid)
        return

    trade = room.get('activeTrade')
    if not trade or trade['proposer'] != active_player['index']:
        return

    target_idx = int(data.get('targetIndex'))
    response = trade['responses'].get(target_idx)
    if not response:
        return

    responder = room['slots'][target_idx]

    if response['status'] == 'accepted':
        give = trade['offer']
        receive = trade['demand']
    elif response['status'] == 'counter':
        give = response['demand']
        receive = response['offer']
    else:
        return

    for res, qty in give.items():
        if active_player['resources'].get(res, 0) < qty:
            await sio.emit('errorMsg', 'Proposer no longer has the resources required to complete this trade.', to=sid)
            return

    for res, qty in receive.items():
        if responder['resources'].get(res, 0) < qty:
            await sio.emit('errorMsg', 'Responder no longer has the resources required to complete this trade.', to=sid)
            return

    for res, qty in give.items():
        active_player['resources'][res] -= qty
        responder['resources'][res] = responder['resources'].get(res, 0) + qty

    for res, qty in receive.items():
        responder['resources'][res] -= qty
        active_player['resources'][res] = active_player['resources'].get(res, 0) + qty

    room['gameLog'].append(f"Trade complete! {active_player['username']} traded with {responder['username']}.")
    room['activeTrade'] = None

    await broadcast_game_state(room)
    await sio.emit('sound', 'build', to=sid)


@sio.on('cheatResources')
async def on_cheat_resources(sid):
    # Debug-only backdoor. Disabled unless CATAN_DEBUG is set in the environment,
    # otherwise any client could grant themselves resources from the browser console.
    if not os.environ.get('CATAN_DEBUG'):
        return
    room, active_player = await get_session_room_and_slot(sid)
    if not room or not active_player:
        return
    for res in ['wood', 'brick', 'sheep', 'wheat', 'ore']:
        active_player['resources'][res] = active_player['resources'].get(res, 0) + 100
    active_player['devCards'].extend(['Knight', 'Year of Plenty', 'Monopoly', 'Road Building'])
    room['gameLog'].append(f"{active_player['username']} cheated resources!")
    await broadcast_game_state(room)


@sio.on('chatMessage')
async def on_chat_message(sid, text):
    import time
    room, slot = await get_session_room_and_slot(sid)
    if not room or not slot:
        return
    text = text.strip()
    if not text:
        return
    room['gameLog'].append(f"[CHAT] {slot['username']}: {text}")
    room['lastActionTime'] = time.time()
    await broadcast_game_state(room)


@sio.on('toggleReady')
async def on_toggle_ready(sid):
    import time
    print(f"[DEBUG] on_toggle_ready received for sid={sid}")
    room, slot = await get_session_room_and_slot(sid)
    print(f"[DEBUG] get_session_room_and_slot returned room={room is not None}, slot={slot['username'] if slot else None}")
    if room and slot:
        print(f"[DEBUG] room['gameState']={room['gameState']}")
    if room and slot and room['gameState'] == 'lobby':
        slot['ready'] = not slot.get('ready', False)
        print(f"[DEBUG] toggled slot['ready'] to {slot['ready']}")
        room['lastActionTime'] = time.time()
        await broadcast_game_state(room)


@sio.on('cycleColor')
async def on_cycle_color(sid, slot_idx):
    import time
    room, slot = await get_session_room_and_slot(sid)
    if not room or not slot or room['gameState'] != 'lobby':
        return
    slot_idx = int(slot_idx)
    if slot['index'] != slot_idx:
        return
    try:
        curr_col_idx = SLOT_COLORS.index(slot['color'])
    except ValueError:
        curr_col_idx = 0
    next_col_idx = (curr_col_idx + 1) % len(SLOT_COLORS)
    slot['color'] = SLOT_COLORS[next_col_idx]
    room['lastActionTime'] = time.time()
    await broadcast_game_state(room)


@sio.on('switchSlot')
async def on_switch_slot(sid, target_idx):
    import time
    room, slot = await get_session_room_and_slot(sid)
    if not room or not slot or room['gameState'] != 'lobby':
        return
    target_idx = int(target_idx)
    if target_idx < 0 or target_idx >= len(room['slots']):
        return
    target_slot = room['slots'][target_idx]
    if target_slot['type'] == 'empty' or (target_slot['type'] == 'human' and target_slot['username'] is None):
        curr_idx = slot['index']
        target_type = target_slot['type']
        
        # Save values first
        username_val = slot['username']
        id_val = slot['id']
        ready_val = slot.get('ready', False)
        secret_val = slot.get('secret')

        # Clear current slot
        room['slots'][curr_idx]['type'] = target_type
        room['slots'][curr_idx]['username'] = None
        room['slots'][curr_idx]['id'] = None
        room['slots'][curr_idx]['ready'] = False
        room['slots'][curr_idx]['secret'] = None

        # Fill target slot
        target_slot['type'] = 'human'
        target_slot['username'] = username_val
        target_slot['id'] = id_val
        target_slot['ready'] = ready_val
        target_slot['secret'] = secret_val
        
        room['lastActionTime'] = time.time()
        await broadcast_game_state(room)


def auto_discard(room, player_idx):
    player = room['slots'][player_idx]
    count_needed = room['discardsPending'].get(player_idx, 0)
    if count_needed <= 0:
        return
    discarded = discard_random_cards(room, player, count_needed)
    room['discardsPending'].pop(player_idx, None)
    room['gameLog'].append(f"{player['username']} timed out. Automatically discarded {discarded} cards.")


def auto_move_robber(room):
    active_idx = room['currentPlayerIndex']
    active_player = room['slots'][active_idx]
    curr_robber = room.get('robberHex')
    valid_hexes = []
    for h in room['board']['hexes']:
        if h['resource'] == 'water':
            continue
        if curr_robber and curr_robber['q'] == h['q'] and curr_robber['r'] == h['r']:
            continue
        valid_hexes.append(h)
    
    if not valid_hexes:
        valid_hexes = [h for h in room['board']['hexes'] if h['resource'] != 'water']
        
    if valid_hexes:
        hex_tile = random.choice(valid_hexes)
        q = hex_tile['q']
        r = hex_tile['r']
        
        adjacent_players = []
        for v_id in hex_tile['vertices']:
            v = room['board']['vertices'][v_id]
            if v['owner'] is not None and v['owner'] != active_idx:
                owner_slot = room['slots'][v['owner']]
                if owner_slot and owner_slot['type'] != 'empty':
                    total_res = sum(owner_slot['resources'].values())
                    if total_res > 0 and owner_slot['index'] not in adjacent_players:
                        adjacent_players.append(owner_slot['index'])
                        
        target_idx = random.choice(adjacent_players) if adjacent_players else None
        
        room['robberHex'] = { 'q': q, 'r': r }
        room['gameLog'].append(f"{active_player['username']} timed out. Automatically moved the Robber.")
        
        if 'robberReturnState' in room and room['robberReturnState']:
            room['gameState'] = room['robberReturnState']['state']
            room['diceRolled'] = room['robberReturnState']['diceRolled']
            room['robberReturnState'] = None
        else:
            room['gameState'] = 'playing'
            room['diceRolled'] = True
            
        if target_idx is not None:
            target_slot = room['slots'][target_idx]
            resources = ['wood', 'brick', 'sheep', 'wheat', 'ore']
            available = [res for res in resources if target_slot['resources'].get(res, 0) > 0]
            if available:
                stolen = random.choice(available)
                target_slot['resources'][stolen] -= 1
                active_player['resources'][stolen] = active_player['resources'].get(stolen, 0) + 1
                room['gameLog'].append(f"{active_player['username']} automatically stole 1 card from {target_slot['username']}.")


def auto_setup_placement(room):
    active_idx = room['currentPlayerIndex']
    active_player = room['slots'][active_idx]
    sub_step = room['setupSubStep']
    
    if sub_step == 'settlement':
        valid_vertices = []
        for v in room['board']['vertices']:
            if v['owner'] is None and vertex_touches_land(room['board'], v['id']):
                adj = get_adjacent_vertices(v['id'], room['board']['edges'])
                too_close = False
                for av_id in adj:
                    if room['board']['vertices'][av_id]['owner'] is not None:
                        too_close = True
                if not too_close:
                    valid_vertices.append(v['id'])
        if valid_vertices:
            v_id = random.choice(valid_vertices)
            vertex = room['board']['vertices'][v_id]
            vertex['owner'] = active_idx
            vertex['building'] = 'settlement'
            active_player['victoryPoints'] += 1
            award_island_vp(room, v_id, active_player)
            room['lastSetupSettlement'] = v_id
            room['setupSubStep'] = 'road'
            room['gameLog'].append(f"{active_player['username']} timed out. Automatically placed settlement.")
            
            N = len(room['slots'])
            if room['setupStep'] >= N:
                for hex_tile in room['board']['hexes']:
                    if v_id in hex_tile['vertices']:
                        if hex_tile['resource'] not in ['desert', 'water']:
                            if room['bank'] and room['bank'].get(hex_tile['resource'], 0) > 0:
                                room['bank'][hex_tile['resource']] -= 1
                                active_player['resources'][hex_tile['resource']] = active_player['resources'].get(hex_tile['resource'], 0) + 1
                                room['gameLog'].append(f"{active_player['username']} received starting resource: 1 {hex_tile['resource']}.")
                                
    elif sub_step == 'road':
        last_v = room.get('lastSetupSettlement')
        valid_edges = []
        for e in room['board']['edges']:
            if e['owner'] is None and e.get('land') and (e['v1'] == last_v or e['v2'] == last_v):
                valid_edges.append(e)
        if valid_edges:
            edge = random.choice(valid_edges)
            edge['owner'] = active_idx
            edge['type'] = 'road'
            room['gameLog'].append(f"{active_player['username']} timed out. Automatically placed road.")
            
            N = len(room['slots'])
            room['setupStep'] += 1
            room['setupSubStep'] = 'settlement'
            room['lastSetupSettlement'] = None
            
            if room['setupStep'] == 2 * N:
                room['gameState'] = 'playing'
                room['currentPlayerIndex'] = 0
                room['diceRolled'] = False
                room['gameLog'].append("Setup complete! Match starts. Roll the dice!")
            else:
                next_active_idx = room['setupStep'] if room['setupStep'] < N else (2 * N - 1 - room['setupStep'])
                room['currentPlayerIndex'] = next_active_idx
                room['gameLog'].append(f"It is now {room['slots'][next_active_idx]['username']}'s turn.")


async def room_timeout_monitor():
    while True:
        try:
            await asyncio.sleep(1)
            import time
            current_time = time.time()
            for room_code, room in list(rooms.items()):
                if room['gameState'] in ['lobby', 'gameover']:
                    continue
                
                timeout_limit = room.get('turnTimeoutLimit', 0)
                if not timeout_limit or timeout_limit <= 0:
                    continue
                
                last_action = room.get('lastActionTime', current_time)
                elapsed = current_time - last_action
                
                if elapsed > timeout_limit:
                    state = room['gameState']
                    
                    if state == 'discard':
                        for p_idx in list(room['discardsPending'].keys()):
                            auto_discard(room, p_idx)
                        if not room['discardsPending']:
                            room['gameState'] = 'robberMove'
                            schedule_bot_action(room['code'])
                        room['lastActionTime'] = time.time()
                        await broadcast_game_state(room)

                    elif state == 'goldChoice':
                        for g_idx in list(room.get('goldPending', {}).keys()):
                            _auto_pick_gold(room, g_idx)
                        room['gameState'] = room.get('goldReturnState') or 'playing'
                        room['goldReturnState'] = None
                        room['lastActionTime'] = time.time()
                        await broadcast_game_state(room)
                        schedule_bot_action(room['code'])

                    elif state == 'robberMove':
                        auto_move_robber(room)
                        room['lastActionTime'] = time.time()
                        await broadcast_game_state(room)
                        schedule_bot_action(room['code'])
                        
                    elif state == 'setup':
                        auto_setup_placement(room)
                        room['lastActionTime'] = time.time()
                        await broadcast_game_state(room)
                        schedule_bot_action(room['code'])
                        
                    elif state in ['playing', 'roadBuilding']:
                        active_idx = room['currentPlayerIndex']
                        active_player = room['slots'][active_idx]
                        
                        room['gameLog'].append(f"{active_player['username']} timed out.")
                        
                        if state == 'playing' and not room['diceRolled']:
                            if room['balancedDice']:
                                d1, d2 = roll_dice_balanced(room)
                            else:
                                d1 = random.randint(1, 6)
                                d2 = random.randint(1, 6)
                            total = d1 + d2
                            room['lastDiceRoll'] = [d1, d2]
                            room['diceRolled'] = True
                            room['gameLog'].append(f"System automatically rolled a {total} ({d1} + {d2}) for {active_player['username']}.")

                            if room['gameMode'] == 'cities':
                                resolve_event_die(room, d1)

                            if room['gameState'] == 'gameover':
                                pass
                            elif total != 7:
                                distribute_resources(room, total)
                                # Timed-out turn: auto-resolve any gold immediately.
                                for g_idx in list(room.get('goldPending', {}).keys()):
                                    _auto_pick_gold(room, g_idx)
                                advance_turn(room)
                            else:
                                room['gameLog'].append("A 7 was rolled! The Robber is activated.")
                                discards_pending = {}
                                for slot in room['slots']:
                                    if slot['type'] != 'empty':
                                        total_cards = hand_size(slot)
                                        if total_cards > discard_limit(slot):
                                            discards_pending[slot['index']] = total_cards // 2
                                room['discardsPending'] = discards_pending
                                for slot in room['slots']:
                                    if slot['type'] != 'empty' and slot['type'].startswith('bot') and slot['index'] in room['discardsPending']:
                                        cards_to_discard = room['discardsPending'][slot['index']]
                                        discard_random_cards(room, slot, cards_to_discard)
                                        room['gameLog'].append(f"{slot['username']} discarded {cards_to_discard} cards.")
                                        room['discardsPending'].pop(slot['index'], None)
                                        
                                if room['discardsPending']:
                                    room['gameState'] = 'discard'
                                else:
                                    room['gameState'] = 'robberMove'
                        else:
                            if 'roadBuildingReturnState' in room and room['roadBuildingReturnState']:
                                room['roadBuildingReturnState'] = None
                            room['roadBuildingState'] = None
                            advance_turn(room)
                            
                        room['lastActionTime'] = time.time()
                        await broadcast_game_state(room)
                        schedule_bot_action(room['code'])
        except Exception as e:
            print(f"Error in room_timeout_monitor: {e}")


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(room_timeout_monitor())


@app.get("/api/maps")
async def api_maps():
    """Static map catalog (topology + metadata) so the lobby can list and
    preview the maps available in each mode. Registered before the static mount
    so it isn't swallowed by the catch-all."""
    return {'maps': map_layouts.all_maps_meta()}


# Serve static frontend files from compiled React build folder
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Start the ASGI Socket.IO app running on port 3000
    uvicorn.run(socket_app, host="0.0.0.0", port=3000)
