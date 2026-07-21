"""
Map layout registry (data-driven boards).

Each map only fixes the *shape* — which axial cells are land / water / gold and
where the ports sit. Resources and number tokens are shuffled per game by the
existing machinery in server.generate_board (resource pool + assign_hex_numbers),
so every game on a given map plays differently while keeping the island/port
structure of the official Colonist.io / Catan Universe scenario.

Coordinate system (must match server.generate_board):
    pointy-top axial (q, r); pixel x = R*sqrt(3)*(q + r/2), y = R*1.5*r
    the six neighbours are (+1,0)(+1,-1)(0,-1)(-1,0)(-1,+1)(0,+1)

A map entry:
    {
      'id','name','desc','modes':[...],'defaultVP':int,
      'hexes':[(q,r,kind), ...],           # kind: 'land' | 'water' | 'gold'
      'pool':[resource, ...],              # len == number of 'land' cells
      'ports':[(q,r,side,type), ...] | None,   # side 0..5 = edge index of hex; None -> auto
    }
"""

import random

# ---------------------------------------------------------------------------
# Axial helpers
# ---------------------------------------------------------------------------
NEIGHBORS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]


def hex_dist(a, b):
    dq, dr = a[0] - b[0], a[1] - b[1]
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def hexagon(radius, center=(0, 0)):
    """All cells within `radius` of center (a filled hexagon)."""
    cq, cr = center
    cells = set()
    for q in range(-radius, radius + 1):
        for r in range(max(-radius, -q - radius), min(radius, -q + radius) + 1):
            cells.add((cq + q, cr + r))
    return cells


def corners(radius, center=(0, 0)):
    """The 6 corner cells of a filled hexagon of the given radius."""
    cq, cr = center
    return {(cq + q, cr + r) for (q, r) in
            [(radius, 0), (0, radius), (-radius, radius),
             (-radius, 0), (0, -radius), (radius, -radius)]}


def _pool(counts):
    """counts: dict resource->n  ->  flat list."""
    out = []
    for res, n in counts.items():
        out.extend([res] * n)
    return out


def _build(land, gold=frozenset(), bound=None, extra_water=frozenset()):
    """Assemble a `hexes` list. Everything in `bound` that is not land/gold is
    water. `bound` defaults to the filled hexagon that encloses all land+gold
    plus one water ring."""
    land = set(land)
    gold = set(gold)
    if bound is None:
        rad = 0
        for c in land | gold:
            rad = max(rad, hex_dist((0, 0), c))
        bound = hexagon(rad + 1)
    cells = set(bound) | land | gold | set(extra_water)
    hexes = []
    for c in sorted(cells):
        if c in gold:
            kind = 'gold'
        elif c in land:
            kind = 'land'
        else:
            kind = 'water'
        hexes.append((c[0], c[1], kind))
    return hexes


def _count_land(hexes):
    return sum(1 for (_q, _r, k) in hexes if k == 'land')


# ---------------------------------------------------------------------------
# Land-only classic boards (basic + cities share these)
# ---------------------------------------------------------------------------
def _classic_standard():
    land = hexagon(2)  # 19 cells
    hexes = [(q, r, 'land') for (q, r) in sorted(land)]
    pool = _pool({'wood': 4, 'sheep': 4, 'wheat': 4, 'brick': 3, 'ore': 3, 'desert': 1})
    return hexes, pool


def _classic_large():
    # 5-6 player: a rounded big hexagon (radius-3 minus the 6 pointy corners) = 31 land.
    land = hexagon(3) - corners(3)
    hexes = [(q, r, 'land') for (q, r) in sorted(land)]
    n = len(land)
    pool = _pool({'wood': 6, 'sheep': 6, 'wheat': 6, 'brick': 5, 'ore': 5, 'desert': 3})
    # keep pool length exactly n
    while len(pool) < n:
        pool.append('desert')
    pool = pool[:n]
    return hexes, pool


# ---------------------------------------------------------------------------
# Seafarers scenario shapes
# ---------------------------------------------------------------------------
def _sf_new_shores():
    # One large main island + three small 2-hex islands around it.
    main = hexagon(2) - corners(2)                      # 13
    isl_a = {(0, -4), (1, -4)}
    isl_b = {(-4, 4), (-4, 3)}
    isl_c = {(4, -1), (4, 0)}
    land = main | isl_a | isl_b | isl_c                 # 19
    pool = _pool({'wood': 4, 'sheep': 4, 'wheat': 4, 'brick': 4, 'ore': 3})
    return _build(land, bound=hexagon(4)), pool


def _sf_four_islands():
    # Four equal 7-hex islands, no dominant main island. Centers pairwise
    # >= 4 apart so the radius-1 islands never touch.
    centers = [(0, -4), (4, -2), (0, 4), (-4, 2)]
    land = set()
    for c in centers:
        land |= hexagon(1, c)
    n = len(land)                                       # 28
    pool = _pool({'wood': 6, 'sheep': 6, 'wheat': 6, 'brick': 5, 'ore': 5})  # 28
    while len(pool) < n:
        pool.append('sheep')
    pool = pool[:n]
    return _build(land, bound=hexagon(5)), pool


def _sf_fog_island():
    # Main island + two outer islands + two gold hexes on the far side.
    main = hexagon(2, (-1, 0)) - corners(2, (-1, 0))    # 13
    isl = {(3, -3), (3, -2), (2, 0), (3, 0)}
    gold = {(4, -4), (-4, 2)}
    land = main | isl                                   # 17
    pool = _pool({'wood': 4, 'sheep': 3, 'wheat': 4, 'brick': 3, 'ore': 3})  # 17
    return _build(land, gold=gold, bound=hexagon(4)), pool


def _sf_through_desert():
    # Home island (left), a mid island, and a far island (right), separated by
    # water. Deserts live in the pool so the board keeps its arid feel; with
    # random resources their exact tiles vary each game.
    home = hexagon(1, (-4, 1))                          # 7
    mid = {(0, -1), (0, 0), (0, 1)}                     # 3
    far = hexagon(1, (4, -1))                           # 7
    land = home | mid | far                             # 17
    n = len(land)
    pool = _pool({'wood': 3, 'sheep': 3, 'wheat': 3, 'brick': 2, 'ore': 3, 'desert': 3})
    while len(pool) < n:
        pool.append('sheep')
    pool = pool[:n]
    return _build(land, bound=hexagon(5)), pool


def _sf_forgotten_tribe():
    # Main island plus a scatter of small (>=2 hex) islands and one gold.
    main = hexagon(2, (-1, 1)) - corners(2, (-1, 1))    # 13
    isl_a = {(3, -4), (3, -3), (3, -2)}                 # 3
    isl_b = {(-3, -1), (-2, -2)}                        # 2
    isl_c = {(3, 0), (3, 1)}                            # 2 (kept clear of the main island)
    gold = {(4, -2)}                                    # attaches to isl_a (no lone island)
    land = main | isl_a | isl_b | isl_c                 # 20
    n = len(land)
    pool = _pool({'wood': 4, 'sheep': 4, 'wheat': 4, 'brick': 4, 'ore': 4})  # 20
    while len(pool) < n:
        pool.append('wood')
    pool = pool[:n]
    return _build(land, gold=gold, bound=hexagon(4)), pool


def _sf_pirate_islands():
    # Two parallel landmasses (your coast vs. the pirates') + a couple of islets.
    west = {(-4, 1), (-4, 2), (-3, 0), (-3, 1), (-3, 2), (-2, 0), (-2, 1)}   # 7
    east = {(4, -2), (4, -1), (3, -2), (3, -1), (3, 0), (2, -1), (2, 0)}     # 7
    islets = {(0, -2), (1, -2), (0, 2), (-1, 2)}                            # two 2-hex islets
    land = west | east | islets                                             # 18
    n = len(land)
    pool = _pool({'wood': 4, 'sheep': 3, 'wheat': 4, 'brick': 3, 'ore': 4})
    while len(pool) < n:
        pool.append('sheep')
    pool = pool[:n]
    return _build(land, bound=hexagon(4)), pool


def _sf_new_world():
    # "Random" seafarers: two 3-hex outer islands around a 7-hex core
    # (this is the current default seafarers layout).
    main = hexagon(1)                                   # 7
    isl_a = {(0, -3), (1, -3), (2, -3)}
    isl_b = {(0, 3), (-1, 3), (-2, 3)}
    land = main | isl_a | isl_b                         # 13
    pool = _pool({'wood': 3, 'sheep': 3, 'wheat': 2, 'brick': 2, 'ore': 2, 'gold': 1})
    return _build(land, bound=hexagon(3)), pool


def _sf_cloth_for_catan():
    # Two parallel coasts (north + south) with a chain of small islands between
    # them — the cloth trade route. (Cloth economy itself is not modelled.)
    north = {(-2, -2), (-1, -2), (0, -2), (1, -2), (0, -3), (1, -3), (2, -3)}   # 7
    south = {(2, 2), (1, 2), (0, 2), (-1, 2), (0, 3), (-1, 3), (-2, 3)}         # 7
    islet_a = {(-3, 0), (-2, 0), (-2, 1)}                                       # 3
    islet_b = {(2, 0), (3, 0), (2, -1)}                                         # 3
    land = north | south | islet_a | islet_b                                   # 20
    pool = _pool({'wood': 4, 'sheep': 4, 'wheat': 4, 'brick': 4, 'ore': 4})     # 20
    return _build(land, bound=hexagon(4)), pool


def _sf_wonders():
    # The Wonders of Catan: one big 19-hex continent alone in the open sea,
    # ringed by four small islands (one bears a gold field).
    main = hexagon(2)                                   # 19
    n = {(0, -4), (1, -4)}                              # + gold (2,-4) -> 3-hex island
    e = {(4, -2), (4, -1)}
    s = {(0, 4), (-1, 4)}
    w = {(-4, 2), (-4, 1)}
    gold = {(2, -4)}
    land = main | n | e | s | w                         # 27
    pool = _pool({'wood': 5, 'sheep': 6, 'wheat': 6, 'brick': 5, 'ore': 5})     # 27
    return _build(land, gold=gold, bound=hexagon(5)), pool


def _sf_greater_catan():
    # Greater Catan (5–6 players): a big main continent, a medium second
    # continent, and three small islands scattered in the sea.
    main = hexagon(2, (-2, 0)) - corners(2, (-2, 0))    # 13 (left)
    second = hexagon(1, (3, 0))                         # 7 (right)
    isl_a = {(-1, -4), (0, -4)}                         # 2
    isl_b = {(-1, 4), (0, 4)}                           # 2
    isl_c = {(2, -4), (3, -4)}                          # 2 (kept clear of the second continent)
    land = main | second | isl_a | isl_b | isl_c        # 26
    n = len(land)
    pool = _pool({'wood': 5, 'sheep': 5, 'wheat': 5, 'brick': 5, 'ore': 6})
    while len(pool) < n:
        pool.append('wheat')
    pool = pool[:n]
    return _build(land, bound=hexagon(5)), pool


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
def _mk(id, name, desc, modes, vp, builder, ports=None):
    hexes, pool = builder()
    assert len(pool) == _count_land(hexes), \
        f"{id}: pool {len(pool)} != land {_count_land(hexes)}"
    return {'id': id, 'name': name, 'desc': desc, 'modes': modes,
            'defaultVP': vp, 'hexes': hexes, 'pool': pool, 'ports': ports}


MAPS = {m['id']: m for m in [
    _mk('standard', 'Standard', 'Bàn 19 hex cổ điển.', ['basic', 'cities'], 10, _classic_standard),
    _mk('large', 'Big Board (5–6)', 'Bàn lớn cho 5–6 người (~31 hex).', ['basic', 'cities'], 10, _classic_large),
    _mk('new_shores', 'Heading for New Shores', 'Đảo chính + 3 đảo nhỏ ven biển.', ['seafarers'], 14, _sf_new_shores),
    _mk('four_islands', 'The Four Islands', '4 đảo tương đương, không đảo chính.', ['seafarers'], 14, _sf_four_islands),
    _mk('fog_island', 'The Fog Island', 'Đảo chính + đảo khám phá + ô vàng.', ['seafarers'], 12, _sf_fog_island),
    _mk('through_desert', 'Through the Desert', 'Đảo nhà, dải sa mạc, đảo tài nguyên bên kia.', ['seafarers'], 14, _sf_through_desert),
    _mk('forgotten_tribe', 'The Forgotten Tribe', 'Đảo chính + nhiều đảo nhỏ + ô vàng.', ['seafarers'], 12, _sf_forgotten_tribe),
    _mk('pirate_islands', 'The Pirate Islands', 'Hai bờ đối diện + đảo nhỏ.', ['seafarers'], 12, _sf_pirate_islands),
    _mk('new_world', 'New World', 'Cụm đảo ngẫu nhiên (mặc định Seafarers).', ['seafarers'], 13, _sf_new_world),
    _mk('cloth_for_catan', 'Cloth for Catan', 'Hai bờ song song + chuỗi đảo nhỏ ở giữa.', ['seafarers'], 14, _sf_cloth_for_catan),
    _mk('wonders', 'The Wonders of Catan', 'Một lục địa lớn giữa biển + 4 đảo nhỏ.', ['seafarers'], 15, _sf_wonders),
    _mk('greater_catan', 'Greater Catan', 'Bàn lớn 5–6 người: lục địa chính + phụ + đảo.', ['seafarers'], 15, _sf_greater_catan),
]}

DEFAULT_MAP = {'basic': 'standard', 'cities': 'standard', 'seafarers': 'new_shores'}


def list_maps(mode):
    """Metadata for every map available in `mode` (safe to send to clients)."""
    out = []
    for m in MAPS.values():
        if mode in m['modes']:
            out.append({
                'id': m['id'], 'name': m['name'], 'desc': m['desc'],
                'modes': m['modes'], 'defaultVP': m['defaultVP'],
                'hexes': [{'q': q, 'r': r, 'kind': k} for (q, r, k) in m['hexes']],
            })
    return out


def all_maps_meta():
    out = []
    for mode in ('basic', 'seafarers', 'cities'):
        for m in list_maps(mode):
            if not any(x['id'] == m['id'] for x in out):
                out.append(m)
    return out


def resolve_map(mode, map_id):
    """Return the full layout for (mode, map_id), falling back to the mode
    default when map_id is missing or not valid for that mode."""
    m = MAPS.get(map_id)
    if m is None or mode not in m['modes']:
        m = MAPS[DEFAULT_MAP.get(mode, 'standard')]
    return m
