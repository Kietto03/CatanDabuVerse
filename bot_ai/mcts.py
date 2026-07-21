"""
Open-loop UCT (MCTS) for the headless engine.

* Chance (dice) and hidden info (steal, dev draw) are sampled fresh inside
  apply_action each simulation → open-loop / determinized UCT.
* Both players' decisions are modelled in the tree; each edge accumulates reward
  from the perspective of the player to move at its parent node.
* Rollouts use the greedy heuristic (policy.greedy_action) for all players, to a
  terminal state or a turn horizon (then reward = share of victory points).
* Placement actions are pruned to the top-K spots so tree branching stays sane.
"""

import math
import random
import time

from . import engine as E
from . import policy as P

UCB_C = 1.4
ROLLOUT_HORIZON_TURNS = 220     # cap rollout length (greedy games end well before)
TOPK_SPOTS = 5                  # keep only the K best placements per action type


def tree_actions(s):
    """Legal actions pruned for the search tree (placements limited to top-K)."""
    acts = E.legal_actions(s)
    if len(acts) <= 12:
        return acts
    out = []
    roads, setts = [], []
    for a in acts:
        if a[0] == 'build_road':
            roads.append(a)
        elif a[0] == 'build_settlement':
            setts.append(a)
        else:
            out.append(a)

    def spot_key(a):
        v1, v2 = s.board.edge_ends[a[1]] if a[0] == 'build_road' else (a[1], a[1])
        return max(P.vertex_score(s, v1), P.vertex_score(s, v2))

    roads.sort(key=spot_key, reverse=True)
    setts.sort(key=lambda a: P.vertex_score(s, a[1]), reverse=True)
    out.extend(setts[:TOPK_SPOTS])
    out.extend(roads[:TOPK_SPOTS])
    return out


class Node:
    __slots__ = ('player', 'children', 'child_N', 'child_W', 'untried', 'N')

    def __init__(self, player):
        self.player = player
        self.children = {}
        self.child_N = {}
        self.child_W = {}
        self.untried = None
        self.N = 0


def _reward_vector(s):
    """Reward in [0,1] per player. Win = 1; otherwise share of total VP."""
    if E.is_terminal(s):
        return {p: (1.0 if p == s.winner else 0.0) for p in range(s.n)}
    vps = [max(0, E.total_vp(s, p)) for p in range(s.n)]
    tot = sum(vps) or 1
    return {p: vps[p] / tot for p in range(s.n)}


def _rollout(s, rng):
    start_turn = s.turn
    while not E.is_terminal(s) and (s.turn - start_turn) < ROLLOUT_HORIZON_TURNS:
        a = P.greedy_action(s, rng)
        if a is None:
            break
        E.apply_action(s, a, rng)
    return _reward_vector(s)


def _ucb_select(node):
    logN = math.log(node.N + 1)
    best, bv = None, -1e18
    for a in node.children:
        n = node.child_N[a]
        if n == 0:
            return a
        q = node.child_W[a] / n
        u = q + UCB_C * math.sqrt(logN / n)
        if u > bv:
            best, bv = a, u
    return best


def _simulate(root, root_state, rng):
    s = root_state.clone()
    path = []
    node = root
    while True:
        if E.is_terminal(s):
            break
        if node.untried is None:
            node.untried = tree_actions(s)
        if node.untried:
            a = node.untried.pop(rng.randrange(len(node.untried)))
            E.apply_action(s, a, rng)
            child = Node(E.current_player(s))
            node.children[a] = child
            node.child_N[a] = 0
            node.child_W[a] = 0
            path.append((node, a))
            node = child
            break
        if not node.children:
            break
        a = _ucb_select(node)
        E.apply_action(s, a, rng)
        path.append((node, a))
        node = node.children[a]

    reward = _rollout(s, rng)
    for (n, a) in path:
        n.N += 1
        n.child_N[a] += 1
        n.child_W[a] += reward[n.player]


def choose_action(state, time_budget_ms=600, max_sims=100000, rng=None, seed=None):
    """Return the best action for the player to move in `state`."""
    rng = rng or random.Random(seed)
    acts = E.legal_actions(state)
    if not acts:
        return None
    if len(acts) == 1:
        return acts[0]

    root = Node(E.current_player(state))
    deadline = time.perf_counter() + time_budget_ms / 1000.0
    sims = 0
    while sims < max_sims and time.perf_counter() < deadline:
        _simulate(root, state, rng)
        sims += 1

    if not root.children:
        return P.greedy_action(state, rng) or acts[0]
    # robust child: most-visited
    best = max(root.children, key=lambda a: root.child_N[a])
    return best


def choose_action_debug(state, **kw):
    rng = kw.get('rng') or random.Random(kw.get('seed'))
    root = Node(E.current_player(state))
    deadline = time.perf_counter() + kw.get('time_budget_ms', 600) / 1000.0
    sims = 0
    while time.perf_counter() < deadline:
        _simulate(root, state, rng)
        sims += 1
    stats = sorted(((root.child_N[a], root.child_W[a] / max(1, root.child_N[a]), a)
                    for a in root.children), reverse=True)
    return sims, stats
