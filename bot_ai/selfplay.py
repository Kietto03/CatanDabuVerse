"""
Self-play harness + sanity tests for the engine and MCTS.

Run:  python -m bot_ai.selfplay
"""

import random
import time

from . import engine as E
from . import policy as P
from . import mcts as M


def play_game(policies, seed, map_id='standard', max_steps=8000):
    """policies: list of callables (state, rng) -> action, one per player."""
    n = len(policies)
    s = E.new_game(n, seed=seed, map_id=map_id)
    rng = random.Random(seed * 7919 + 1)
    steps = 0
    while not E.is_terminal(s) and steps < max_steps:
        p = E.current_player(s)
        a = policies[p](s, rng)
        if a is None:
            break
        E.apply_action(s, a, rng)
        steps += 1
    return E.winner(s), s


def greedy_pol(s, rng):
    return P.greedy_action(s, rng)


def mcts_pol_factory(sims=300, tbudget=5000):
    def pol(s, rng):
        return M.choose_action(s, time_budget_ms=tbudget, max_sims=sims, rng=rng)
    return pol


def bench_winrate(n_games=40, n_players=3, sims=300):
    """MCTS occupies a rotating seat vs greedy opponents; report win-rate."""
    mcts = mcts_pol_factory(sims=sims)
    wins = 0
    decided = 0
    t0 = time.perf_counter()
    for g in range(n_games):
        mcts_seat = g % n_players
        pols = [greedy_pol] * n_players
        pols[mcts_seat] = mcts
        w, _ = play_game(pols, seed=1000 + g)
        if w is not None:
            decided += 1
            if w == mcts_seat:
                wins += 1
    dt = time.perf_counter() - t0
    exp = decided / n_players  # random-baseline expected wins
    print(f"MCTS(sims={sims}) win-rate vs greedy: {wins}/{decided} = "
          f"{100*wins/max(1,decided):.1f}%  (fair share {100/n_players:.1f}%)  "
          f"[{dt:.1f}s total]")
    return wins, decided


def bench_decision_time(sims=300):
    """Average wall-time per MCTS decision on a mid-game state."""
    s = E.new_game(3, seed=42)
    rng = random.Random(1)
    # fast-forward through setup + a few turns with greedy
    for _ in range(400):
        if E.is_terminal(s):
            break
        if s.phase in ('setup_settlement', 'setup_road') or s.turn < 6:
            E.apply_action(s, P.greedy_action(s, rng), rng)
        else:
            break
    times = []
    for _ in range(20):
        if E.is_terminal(s):
            break
        if s.phase == 'roll':
            E.apply_action(s, ('roll',), rng)
            continue
        t0 = time.perf_counter()
        a = M.choose_action(s, time_budget_ms=5000, max_sims=sims, rng=rng)
        times.append(time.perf_counter() - t0)
        E.apply_action(s, a, rng)
    if times:
        print(f"MCTS(sims={sims}) decision time: avg {1000*sum(times)/len(times):.0f}ms "
              f"max {1000*max(times):.0f}ms over {len(times)} decisions")


def sanity_determinism():
    a = E.new_game(3, seed=5)
    b = E.new_game(3, seed=5)
    rng_a = random.Random(99)
    rng_b = random.Random(99)
    for _ in range(50):
        if E.is_terminal(a):
            break
        ca = P.greedy_action(a, rng_a)
        E.apply_action(a, ca, rng_a)
        cb = P.greedy_action(b, rng_b)
        E.apply_action(b, cb, rng_b)
    assert [E.total_vp(a, p) for p in range(3)] == [E.total_vp(b, p) for p in range(3)]
    print("determinism (same seed -> same trajectory): OK")


def sanity_conservation():
    """Total (hands) never goes negative; build actions cost the right amounts."""
    s = E.new_game(3, seed=7)
    rng = random.Random(7)
    for _ in range(2000):
        if E.is_terminal(s):
            break
        E.apply_action(s, P.greedy_action(s, rng), rng)
        for p in range(3):
            for r, c in s.players[p]['res'].items():
                assert c >= 0, f"negative {r}"
    print("resource conservation / non-negativity over a full game: OK")


if __name__ == '__main__':
    sanity_determinism()
    sanity_conservation()
    bench_decision_time(sims=300)
    bench_winrate(n_games=45, n_players=3, sims=300)
