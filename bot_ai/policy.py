"""
Fast greedy heuristic policy for the engine — used both as MCTS rollout
default-policy and as the baseline opponent to measure MCTS against. Mirrors the
spirit of server.py's `_bot_vertex_score` / `do_bot_build_phase`.
"""

from . import engine as E


def vertex_score(s, vid):
    """Quality of an intersection = adjacent hex pips + resource diversity."""
    score = 0
    seen = set()
    for hi in s.board.vertex_hexes[vid]:
        h = s.board.hexes[hi]
        if h['resource'] not in ('water', 'desert') and h.get('number'):
            score += E.NUMBER_PIPS.get(h['number'], 0)
            seen.add(h['resource'])
    return score + len(seen)


def _best(actions, key):
    best, bv = None, None
    for a in actions:
        v = key(a)
        if bv is None or v > bv:
            best, bv = a, v
    return best


def greedy_action(s, rng):
    """Pick a reasonable action for the current player."""
    acts = E.legal_actions(s)
    if not acts:
        return None
    p = E.current_player(s)

    if s.phase == 'setup_settlement':
        return _best(acts, lambda a: vertex_score(s, a[1]))

    if s.phase == 'setup_road':
        # road toward the highest-scoring neighbouring empty vertex
        def road_key(a):
            v1, v2 = s.board.edge_ends[a[1]]
            return max(vertex_score(s, v1), vertex_score(s, v2))
        return _best(acts, road_key)

    if s.phase == 'roll':
        return ('roll',)

    if s.phase in ('robber',):
        # place robber to hurt the leader; steal from the richest victim
        def rob_key(a):
            _, hi, vic = a
            # value of the hex to opponents
            pips = 0
            for v in s.board.hexes[hi]['vertices']:
                o = s.v_owner[v]
                if o is not None and o != p:
                    h = s.board.hexes[hi]
                    if h.get('number'):
                        pips += E.NUMBER_PIPS.get(h['number'], 0) * (2 if s.v_building[v] == 'city' else 1)
            steal = 0 if vic is None else sum(s.players[vic]['res'].values())
            return pips + steal * 0.5
        return _best(acts, rob_key)

    if s.phase == 'road_building':
        def rb_key(a):
            v1, v2 = s.board.edge_ends[a[1]]
            return max(vertex_score(s, v1), vertex_score(s, v2))
        cand = [a for a in acts if a[0] == 'build_road']
        return _best(cand, rb_key) if cand else ('end_turn',)

    # build phase — greedy priority
    cities = [a for a in acts if a[0] == 'build_city']
    if cities:
        return _best(cities, lambda a: vertex_score(s, a[1]))
    setts = [a for a in acts if a[0] == 'build_settlement']
    if setts:
        return _best(setts, lambda a: vertex_score(s, a[1]))

    # play knight if it helps (before rolling would be better, but simple here)
    knight = [a for a in acts if a[0] == 'play_dev' and a[1] == 'knight']
    if knight and s.players[p]['knights'] >= 2:
        return knight[0]

    dev = [a for a in acts if a[0] == 'buy_dev']
    if dev and rng.random() < 0.5:
        return dev[0]

    roads = [a for a in acts if a[0] == 'build_road']
    if roads and rng.random() < 0.6:
        def road_key(a):
            v1, v2 = s.board.edge_ends[a[1]]
            return max(vertex_score(s, v1) if s.v_owner[v1] is None else 0,
                       vertex_score(s, v2) if s.v_owner[v2] is None else 0)
        return _best(roads, road_key)

    # occasional trade toward a settlement/city
    trades = [a for a in acts if a[0] == 'bank_trade']
    if trades and rng.random() < 0.25:
        return rng.choice(trades)

    return ('end_turn',)
