"""
Headless, deterministic Catan engine for mode `basic`.

Design goals:
  * pure Python, no socket.io / async — fast enough to simulate thousands of
    turns for MCTS rollouts.
  * cheap cloning: the immutable board *topology* (Board) is shared across all
    clones; only the small mutable occupancy/hands live in the game State.
  * faithful to server.py's basic-mode rules (costs, distance rule, robber-on-7,
    discard>7, dev cards, longest road, largest army, bank/port trades). The
    server stays authoritative at runtime — this engine only drives the bot's
    internal search, so minor drift at worst causes a fallback.

Action vocabulary (tuples):
  ('setup_settlement', vid) ('setup_road', eid)
  ('roll',)
  ('build_settlement', vid) ('build_city', vid) ('build_road', eid)
  ('buy_dev',) ('play_dev', card, params)
  ('bank_trade', give_res, get_res)
  ('move_robber', hex_index, victim_or_None)
  ('end_turn',)
"""

import random

import rules

RES = ['wood', 'brick', 'sheep', 'wheat', 'ore']
NUMBER_PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 0, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}

COST_ROAD = {'wood': 1, 'brick': 1}
COST_SETTLEMENT = {'wood': 1, 'brick': 1, 'sheep': 1, 'wheat': 1}
COST_CITY = {'ore': 3, 'wheat': 2}
COST_DEV = {'ore': 1, 'sheep': 1, 'wheat': 1}

MAX_SETTLEMENTS = 5
MAX_CITIES = 4
MAX_ROADS = 15


# ---------------------------------------------------------------------------
# Immutable board topology (shared across clones)
# ---------------------------------------------------------------------------
class Board:
    def __init__(self, raw):
        self.raw = raw
        self.hexes = raw['hexes']
        self.n_vertices = len(raw['vertices'])
        self.edges = raw['edges']
        self.edge_ids = [e['id'] for e in raw['edges']]
        self.edge_ends = {e['id']: (e['v1'], e['v2']) for e in raw['edges']}

        # vertex -> incident edge ids, adjacent vertices
        self.vertex_edges = {v: [] for v in range(self.n_vertices)}
        self.vertex_adj = {v: [] for v in range(self.n_vertices)}
        for e in raw['edges']:
            self.vertex_edges[e['v1']].append(e['id'])
            self.vertex_edges[e['v2']].append(e['id'])
            self.vertex_adj[e['v1']].append(e['v2'])
            self.vertex_adj[e['v2']].append(e['v1'])

        # vertex -> list of (hex_index) touching it
        self.vertex_hexes = {v: [] for v in range(self.n_vertices)}
        for hi, h in enumerate(self.hexes):
            for v in h['vertices']:
                self.vertex_hexes[v].append(hi)

        # number -> list of hex indices (land only, non-robber-independent)
        self.number_hexes = {}
        for hi, h in enumerate(self.hexes):
            if h['resource'] not in ('water', 'desert') and h.get('number'):
                self.number_hexes.setdefault(h['number'], []).append(hi)

        # ports: vertex -> best trade ratios {resource: ratio}
        self.vertex_port = {}
        for p in raw['ports']:
            for v in p['vertices']:
                self.vertex_port.setdefault(v, set()).add(p['type'])

        # desert / robber start hex
        self.desert_hex = next((hi for hi, h in enumerate(self.hexes)
                                if h['resource'] == 'desert'), None)
        if self.desert_hex is None:
            self.desert_hex = next((hi for hi, h in enumerate(self.hexes)
                                    if h['resource'] == 'water'), 0)

    def trade_ratio(self, player_vertices, resource):
        """Best bank/port ratio available to a player for `resource`."""
        ratio = 4
        for v in player_vertices:
            ports = self.vertex_port.get(v)
            if not ports:
                continue
            if resource in ports:
                ratio = min(ratio, 2)
            if 'generic' in ports:
                ratio = min(ratio, 3)
        return ratio


# ---------------------------------------------------------------------------
# Game state (mutable, cheaply cloneable)
# ---------------------------------------------------------------------------
class State:
    __slots__ = ('board', 'n', 'vp_limit', 'v_owner', 'v_building', 'e_owner',
                 'robber', 'players', 'dev_deck', 'turn', 'phase', 'to_discard',
                 'last_settlement', 'setup_index', 'roads_free', 'longest_holder',
                 'army_holder', 'winner', 'played_dev_this_turn', 'dice')

    def clone(self):
        s = State.__new__(State)
        s.board = self.board          # shared immutable
        s.n = self.n
        s.vp_limit = self.vp_limit
        s.v_owner = self.v_owner[:]
        s.v_building = self.v_building[:]
        s.e_owner = dict(self.e_owner)
        s.robber = self.robber
        s.players = [{
            'res': dict(p['res']),
            'dev': list(p['dev']),
            'new_dev': list(p['new_dev']),
            'vp_cards': p['vp_cards'],
            'knights': p['knights'],
        } for p in self.players]
        s.dev_deck = self.dev_deck[:]
        s.turn = self.turn
        s.phase = self.phase
        s.to_discard = dict(self.to_discard)
        s.last_settlement = self.last_settlement
        s.setup_index = self.setup_index
        s.roads_free = self.roads_free
        s.longest_holder = self.longest_holder
        s.army_holder = self.army_holder
        s.winner = self.winner
        s.played_dev_this_turn = self.played_dev_this_turn
        s.dice = self.dice
        return s


def new_game(n_players, seed=None, map_id='standard'):
    rng = random.Random(seed)
    # generate_board uses the global `random`; seed it for reproducibility
    if seed is not None:
        random.seed(seed)
    board = Board(rules.generate_board('basic', map_id))

    s = State.__new__(State)
    s.board = board
    s.n = n_players
    s.vp_limit = 10
    s.v_owner = [None] * board.n_vertices
    s.v_building = [None] * board.n_vertices
    s.e_owner = {}
    s.robber = board.desert_hex
    s.players = [{'res': {r: 0 for r in RES}, 'dev': [], 'new_dev': [],
                  'vp_cards': 0, 'knights': 0} for _ in range(n_players)]
    # dev deck: 14 knight, 5 vp, 2 each monopoly/yop/road_building
    deck = (['knight'] * 14 + ['vp'] * 5 + ['monopoly'] * 2 +
            ['yop'] * 2 + ['road_building'] * 2)
    rng.shuffle(deck)
    s.dev_deck = deck
    # setup: snake order over 2*n placements
    s.setup_index = 0
    s.turn = 0
    s.phase = 'setup_settlement'
    s.to_discard = {}
    s.last_settlement = None
    s.roads_free = 0
    s.longest_holder = None
    s.army_holder = None
    s.winner = None
    s.played_dev_this_turn = False
    s.dice = None
    return s


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _setup_player(s):
    """Current player during the snake-order setup."""
    k = s.setup_index
    if k < s.n:
        return k                 # round 1: 0..n-1
    return 2 * s.n - 1 - k       # round 2: n-1..0


def current_player(s):
    if s.phase in ('setup_settlement', 'setup_road'):
        return _setup_player(s)
    return s.turn % s.n


def player_vertices(s, p):
    return [v for v in range(s.board.n_vertices) if s.v_owner[v] == p]


def _can_afford(res, cost):
    return all(res.get(k, 0) >= v for k, v in cost.items())


def _pay(res, cost):
    for k, v in cost.items():
        res[k] -= v


def _distance_ok(s, vid):
    if s.v_owner[vid] is not None:
        return False
    for a in s.board.vertex_adj[vid]:
        if s.v_owner[a] is not None:
            return False
    return True


def _vertex_road_connected(s, vid, p):
    return any(s.e_owner.get(eid) == p for eid in s.board.vertex_edges[vid])


def _edge_connected(s, eid, p):
    v1, v2 = s.board.edge_ends[eid]
    for v in (v1, v2):
        if s.v_owner[v] == p:
            return True
        # empty vertex reachable if player has an adjacent road (not blocked by opponent)
        if s.v_owner[v] is None:
            for e2 in s.board.vertex_edges[v]:
                if e2 != eid and s.e_owner.get(e2) == p:
                    return True
    return False


def total_vp(s, p):
    vp = 0
    for v in range(s.board.n_vertices):
        if s.v_owner[v] == p:
            vp += 2 if s.v_building[v] == 'city' else 1
    vp += s.players[p]['vp_cards']
    if s.longest_holder == p:
        vp += 2
    if s.army_holder == p:
        vp += 2
    return vp


# ---------- longest road (port of server's DFS) ----------
def _longest_road_len(s, p):
    edges = [eid for eid, o in s.e_owner.items() if o == p]
    if not edges:
        return 0
    ends = s.board.edge_ends
    adjE = {}
    for eid in edges:
        v1, v2 = ends[eid]
        adjE.setdefault(v1, []).append((eid, v2))
        adjE.setdefault(v2, []).append((eid, v1))
    best = 0

    def blocked(v):
        # an opponent building on v breaks the path through v
        return s.v_owner[v] is not None and s.v_owner[v] != p

    def dfs(v, used):
        nonlocal best
        if len(used) > best:
            best = len(used)
        for (eid, nxt) in adjE.get(v, []):
            if eid in used:
                continue
            if blocked(v):
                continue
            used.add(eid)
            dfs(nxt, used)
            used.discard(eid)

    for eid in edges:
        v1, v2 = ends[eid]
        dfs(v1, {eid})
        dfs(v2, {eid})
    return best


def _update_longest_road(s):
    lengths = [(_longest_road_len(s, p), p) for p in range(s.n)]
    best_len = max(l for l, _ in lengths)
    if best_len < 5:
        s.longest_holder = None
        return
    holders = [p for l, p in lengths if l == best_len]
    if s.longest_holder in holders:
        return  # incumbent keeps it on ties
    if len(holders) == 1:
        s.longest_holder = holders[0]


def _update_largest_army(s):
    best = max(s.players[p]['knights'] for p in range(s.n))
    if best < 3:
        return
    holders = [p for p in range(s.n) if s.players[p]['knights'] == best]
    if s.army_holder in holders:
        return
    if len(holders) == 1:
        s.army_holder = holders[0]


def _check_winner(s):
    for p in range(s.n):
        if total_vp(s, p) >= s.vp_limit:
            s.winner = p
            return


# ---------------------------------------------------------------------------
# Legal actions
# ---------------------------------------------------------------------------
def legal_actions(s):
    if s.winner is not None:
        return []
    p = current_player(s)
    ph = s.phase

    if ph == 'setup_settlement':
        return [('setup_settlement', v) for v in range(s.board.n_vertices)
                if _distance_ok(s, v)]

    if ph == 'setup_road':
        last = s.last_settlement
        return [('setup_road', eid) for eid in s.board.vertex_edges[last]
                if eid not in s.e_owner]

    if ph == 'roll':
        return [('roll',)]

    if ph == 'robber':
        acts = []
        for hi in range(len(s.board.hexes)):
            if hi == s.robber:
                continue
            if s.board.hexes[hi]['resource'] == 'water':
                continue
            victims = _robber_victims(s, hi, p)
            if victims:
                for vic in victims:
                    acts.append(('move_robber', hi, vic))
            else:
                acts.append(('move_robber', hi, None))
        return acts

    if ph == 'road_building':
        acts = [('build_road', eid) for eid in s.board.edge_ids
                if eid not in s.e_owner and _edge_connected(s, eid, p)]
        return acts or [('end_turn',)]  # nowhere to place -> abort

    # build phase
    acts = [('end_turn',)]
    res = s.players[p]['res']
    n_sett = sum(1 for v in range(s.board.n_vertices)
                 if s.v_owner[v] == p and s.v_building[v] == 'settlement')
    n_city = sum(1 for v in range(s.board.n_vertices)
                 if s.v_owner[v] == p and s.v_building[v] == 'city')
    n_road = sum(1 for o in s.e_owner.values() if o == p)

    if _can_afford(res, COST_ROAD) and n_road < MAX_ROADS:
        for eid in s.board.edge_ids:
            if eid not in s.e_owner and _edge_connected(s, eid, p):
                acts.append(('build_road', eid))
    if _can_afford(res, COST_SETTLEMENT) and n_sett < MAX_SETTLEMENTS:
        for v in range(s.board.n_vertices):
            if _distance_ok(s, v) and _vertex_road_connected(s, v, p):
                acts.append(('build_settlement', v))
    if _can_afford(res, COST_CITY) and n_city < MAX_CITIES:
        for v in range(s.board.n_vertices):
            if s.v_owner[v] == p and s.v_building[v] == 'settlement':
                acts.append(('build_city', v))
    if _can_afford(res, COST_DEV) and s.dev_deck:
        acts.append(('buy_dev',))
    # play a dev card (one per turn, not one bought this turn)
    if not s.played_dev_this_turn:
        hand = s.players[p]['dev']
        for card in set(hand):
            if card == 'vp':
                continue
            if card == 'knight':
                acts.append(('play_dev', 'knight', None))
            elif card == 'monopoly':
                for r in RES:
                    acts.append(('play_dev', 'monopoly', r))
            elif card == 'yop':
                for i, a in enumerate(RES):
                    for b in RES[i:]:
                        acts.append(('play_dev', 'yop', (a, b)))
            elif card == 'road_building':
                acts.append(('play_dev', 'road_building', None))
    # bank / port trades
    pv = player_vertices(s, p)
    for give in RES:
        ratio = s.board.trade_ratio(pv, give)
        if res.get(give, 0) >= ratio:
            for get in RES:
                if get != give:
                    acts.append(('bank_trade', give, get))
    return acts


def _robber_victims(s, hex_index, mover):
    victims = set()
    for v in s.board.hexes[hex_index]['vertices']:
        o = s.v_owner[v]
        if o is not None and o != mover and sum(s.players[o]['res'].values()) > 0:
            victims.add(o)
    return sorted(victims)


# ---------------------------------------------------------------------------
# Apply action
# ---------------------------------------------------------------------------
def apply_action(s, action, rng):
    """Mutates and returns s (call clone() first if you need immutability)."""
    p = current_player(s)
    kind = action[0]

    if kind == 'setup_settlement':
        v = action[1]
        s.v_owner[v] = p
        s.v_building[v] = 'settlement'
        s.last_settlement = v
        # 2nd-round settlement yields starting resources
        if s.setup_index >= s.n:
            for hi in s.board.vertex_hexes[v]:
                h = s.board.hexes[hi]
                if h['resource'] not in ('desert', 'water'):
                    s.players[p]['res'][h['resource']] += 1
        s.phase = 'setup_road'
        return s

    if kind == 'setup_road':
        s.e_owner[action[1]] = p
        s.last_settlement = None
        s.setup_index += 1
        if s.setup_index >= 2 * s.n:
            s.phase = 'roll'
            s.turn = 0
        else:
            s.phase = 'setup_settlement'
        return s

    if kind == 'roll':
        d = rng.randint(1, 6) + rng.randint(1, 6)
        s.dice = d
        if d == 7:
            _apply_discards(s, rng)
            s.phase = 'robber'
        else:
            _distribute(s, d)
            s.phase = 'build'
        return s

    if kind == 'move_robber':
        _, hi, victim = action
        s.robber = hi
        if victim is not None:
            pool = [r for r, c in s.players[victim]['res'].items() for _ in range(c)]
            if pool:
                stolen = rng.choice(pool)
                s.players[victim]['res'][stolen] -= 1
                s.players[p]['res'][stolen] += 1
        s.phase = 'build'
        return s

    if kind == 'build_road':
        s.e_owner[action[1]] = p
        if s.phase == 'road_building':
            s.roads_free -= 1
            if s.roads_free <= 0:
                s.phase = 'build'
        else:
            _pay(s.players[p]['res'], COST_ROAD)
        _update_longest_road(s)
        _check_winner(s)
        return s

    if kind == 'build_settlement':
        v = action[1]
        _pay(s.players[p]['res'], COST_SETTLEMENT)
        s.v_owner[v] = p
        s.v_building[v] = 'settlement'
        _update_longest_road(s)  # a settlement can cut an opponent's road
        _check_winner(s)
        return s

    if kind == 'build_city':
        v = action[1]
        _pay(s.players[p]['res'], COST_CITY)
        s.v_building[v] = 'city'
        _check_winner(s)
        return s

    if kind == 'buy_dev':
        _pay(s.players[p]['res'], COST_DEV)
        card = s.dev_deck.pop()
        if card == 'vp':
            s.players[p]['vp_cards'] += 1
            _check_winner(s)
        else:
            s.players[p]['new_dev'].append(card)
        return s

    if kind == 'play_dev':
        _, card, params = action
        s.players[p]['dev'].remove(card)
        s.played_dev_this_turn = True
        if card == 'knight':
            s.players[p]['knights'] += 1
            _update_largest_army(s)
            _check_winner(s)
            s.phase = 'robber'
        elif card == 'monopoly':
            r = params
            got = 0
            for q in range(s.n):
                if q == p:
                    continue
                got += s.players[q]['res'][r]
                s.players[q]['res'][r] = 0
            s.players[p]['res'][r] += got
        elif card == 'yop':
            for r in params:
                s.players[p]['res'][r] += 1
        elif card == 'road_building':
            free = sum(1 for eid in s.board.edge_ids
                       if eid not in s.e_owner and _edge_connected(s, eid, p))
            s.roads_free = min(2, free)
            if s.roads_free > 0:
                s.phase = 'road_building'
        return s

    if kind == 'bank_trade':
        give, get = action[1], action[2]
        ratio = s.board.trade_ratio(player_vertices(s, p), give)
        s.players[p]['res'][give] -= ratio
        s.players[p]['res'][get] += 1
        return s

    if kind == 'end_turn':
        # move new dev cards into playable hand
        pl = s.players[p]
        pl['dev'].extend(pl['new_dev'])
        pl['new_dev'] = []
        s.played_dev_this_turn = False
        s.turn += 1
        s.phase = 'roll'
        return s

    raise ValueError(f"unknown action {action}")


def _distribute(s, d):
    for hi in s.board.number_hexes.get(d, []):
        if hi == s.robber:
            continue
        res = s.board.hexes[hi]['resource']
        for v in s.board.hexes[hi]['vertices']:
            o = s.v_owner[v]
            if o is not None:
                s.players[o]['res'][res] += 2 if s.v_building[v] == 'city' else 1


def _apply_discards(s, rng):
    """Players with >7 cards discard half (rounded down). Auto-resolved by a
    simple 'discard from your most-plentiful resources' heuristic."""
    for q in range(s.n):
        res = s.players[q]['res']
        total = sum(res.values())
        if total > 7:
            n_discard = total // 2
            for _ in range(n_discard):
                # discard one of the most-held resources
                r = max(RES, key=lambda x: res[x])
                if res[r] <= 0:
                    break
                res[r] -= 1


def is_terminal(s):
    return s.winner is not None


def winner(s):
    return s.winner
