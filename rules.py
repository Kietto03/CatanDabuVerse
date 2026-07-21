"""
Pure board-generation rules shared by the authoritative server (`server.py`)
and the headless simulation engine (`bot_ai/engine.py`).

Keeping these here (instead of in server.py) lets the engine build boards
without importing server.py — which would register socket handlers, mount the
static app, and create an import cycle with the bot integration.
"""

import math
import random

import map_layouts


def assign_hex_numbers(hexes):
    """Assign number tokens to land hexes so the two red numbers (6 and 8) are
    never on hexes that share an edge — matching the official Catan setup rule."""
    number_pool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
    land_hexes = [h for h in hexes if h['resource'] not in ('desert', 'water')]
    n = len(land_hexes)
    if n == 0:
        return

    numbers = list(number_pool)
    # Pad or trim so we have exactly one number per land hex
    while len(numbers) < n:
        numbers.append(random.choice([3, 4, 5, 6, 8, 9, 10, 11]))
    numbers = numbers[:n]

    # Adjacency between land hexes: two hexes are adjacent iff they share an edge
    edge_to_hexes = {}
    for i, h in enumerate(land_hexes):
        for e_id in h['edges']:
            edge_to_hexes.setdefault(e_id, []).append(i)
    adj = [set() for _ in range(n)]
    for shared in edge_to_hexes.values():
        for a in range(len(shared)):
            for b in range(a + 1, len(shared)):
                adj[shared[a]].add(shared[b])
                adj[shared[b]].add(shared[a])

    RED = {6, 8}

    def is_valid(order):
        for i in range(n):
            if order[i] in RED:
                for j in adj[i]:
                    if order[j] in RED:
                        return False
        return True

    # Reshuffle until the red-adjacency constraint holds (trivially fast for a
    # standard board); fall back to the last shuffle if no valid layout is found.
    for _ in range(2000):
        random.shuffle(numbers)
        if is_valid(numbers):
            break

    for i, h in enumerate(land_hexes):
        h['number'] = numbers[i]


# Board Layout Generator
def generate_board(mode, map_id=None):
    R = 60  # hex radius
    vertices = []
    edges = []
    edge_map = {}

    def get_or_create_vertex(x, y):
        x_round = round(x * 10) / 10
        y_round = round(y * 10) / 10
        for v in vertices:
            if math.hypot(v['x'] - x_round, v['y'] - y_round) < 2.0:
                return v
        new_v = {
            'id': len(vertices),
            'x': x_round,
            'y': y_round,
            'owner': None,
            'building': None,
            'knight': None,     # Cities & Knights: {'owner','level','active',...}
            'metropolis': None  # Cities & Knights: track name if this city is a metropolis
        }
        vertices.append(new_v)
        return new_v

    def get_or_create_edge(v1_id, v2_id):
        key = f"{min(v1_id, v2_id)}-{max(v1_id, v2_id)}"
        if key in edge_map:
            return edge_map[key]
        new_edge = {
            'id': key,
            'v1': v1_id,
            'v2': v2_id,
            'owner': None,
            'type': None,          # 'road' | 'ship' once built
            'builtThisTurn': False  # blocks moving a ship the turn it was placed
        }
        edges.append(new_edge)
        edge_map[key] = new_edge
        return new_edge

    hexes = []

    # Board shape comes from the map registry (map_layouts.py). A layout fixes
    # only the topology — which axial cells are land / water / gold and where
    # ports sit; resources are drawn from a shuffled pool and number tokens are
    # assigned below, so each game on a map plays differently.
    layout = map_layouts.resolve_map(mode, map_id)
    pool = list(layout['pool'])
    random.shuffle(pool)

    for (q, r, kind) in layout['hexes']:
        x = R * math.sqrt(3) * (q + r / 2)
        y = R * 1.5 * r

        if kind == 'water':
            resource = 'water'
        elif kind == 'gold':
            resource = 'gold'
        else:  # 'land'
            resource = pool.pop() if pool else 'desert'
        number = None  # numbers assigned later with the red-adjacency rule

        hex_vertices = []
        for i in range(6):
            theta = (math.pi / 6) + (i * math.pi / 3)
            vx = x + R * math.cos(theta)
            vy = y + R * math.sin(theta)
            v = get_or_create_vertex(vx, vy)
            hex_vertices.append(v['id'])

        hex_edges = []
        for i in range(6):
            v1 = hex_vertices[i]
            v2 = hex_vertices[(i + 1) % 6]
            e = get_or_create_edge(v1, v2)
            hex_edges.append(e['id'])

        hexes.append({
            'q': q, 'r': r,
            'x': round(x * 10) / 10,
            'y': round(y * 10) / 10,
            'resource': resource,
            'number': number,
            'vertices': hex_vertices,
            'edges': hex_edges
        })

    # ----------------------------------------------------
    # Assign number tokens (official rule: the two red numbers 6 and 8
    # may never sit on hexes that share an edge)
    # ----------------------------------------------------
    assign_hex_numbers(hexes)

    # ----------------------------------------------------
    # Ports: use the layout's fixed ports if it defines them, otherwise auto-
    # generate 9 ports around the land perimeter.
    # ----------------------------------------------------
    ports = []
    if layout.get('ports'):
        hex_by_qr = {(h['q'], h['r']): h for h in hexes}
        for idx, (pq, pr, side, ptype) in enumerate(layout['ports']):
            h = hex_by_qr.get((pq, pr))
            if not h:
                continue
            e_id = h['edges'][side % 6]
            edge = next(e for e in edges if e['id'] == e_id)
            ports.append({'id': idx, 'type': ptype, 'vertices': [edge['v1'], edge['v2']]})
    else:
        edge_counts = {}
        for h in hexes:
            if h['resource'] not in ['water']:
                for e_id in h['edges']:
                    edge_counts[e_id] = edge_counts.get(e_id, 0) + 1

        outer_edge_ids = [e_id for e_id, count in edge_counts.items() if count == 1]

        hex_outer_edges = {}
        for h in hexes:
            if h['resource'] not in ['water']:
                h_outer = [e_id for e_id in h['edges'] if e_id in outer_edge_ids]
                if h_outer:
                    hex_outer_edges[f"{h['q']},{h['r']}"] = {
                        'hex': h,
                        'outer_edges': h_outer,
                        'angle': math.atan2(h['y'], h['x'])
                    }

        sorted_outer_keys = sorted(hex_outer_edges.keys(), key=lambda k: hex_outer_edges[k]['angle'])

        selected_hex_keys = []
        N_outer = len(sorted_outer_keys)
        if N_outer <= 9:
            selected_hex_keys = sorted_outer_keys
        else:
            # Drop 3 items to get exactly 9 ports evenly spaced
            drop_indices = {round(i * N_outer / 3) % N_outer for i in range(3)}
            selected_hex_keys = [sorted_outer_keys[i] for i in range(N_outer) if i not in drop_indices]
            if len(selected_hex_keys) > 9:
                selected_hex_keys = selected_hex_keys[:9]

        port_types = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'generic', 'generic', 'generic', 'generic']
        random.shuffle(port_types)
        port_types = port_types[:len(selected_hex_keys)]

        for idx, key in enumerate(selected_hex_keys):
            h_data = hex_outer_edges[key]
            selected_edge_id = h_data['outer_edges'][0]
            edge = next(e for e in edges if e['id'] == selected_edge_id)
            ports.append({
                'id': idx,
                'type': port_types[idx],
                'vertices': [edge['v1'], edge['v2']]
            })

    # ----------------------------------------------------
    # Classify edges (Seafarers): a 'sea' edge borders a water hex (ships go
    # here), a 'land' edge borders a land hex (roads go here). Coastal edges
    # border both and accept either piece.
    # ----------------------------------------------------
    edge_borders_water = {}
    edge_borders_land = {}
    for h in hexes:
        is_water = h['resource'] == 'water'
        for e_id in h['edges']:
            if is_water:
                edge_borders_water[e_id] = True
            else:
                edge_borders_land[e_id] = True
    for e in edges:
        e['sea'] = bool(edge_borders_water.get(e['id']))
        e['land'] = bool(edge_borders_land.get(e['id']))

    # ----------------------------------------------------
    # Group land hexes into islands (connected components sharing an edge).
    # The largest component is the "main island"; settling any other island
    # for the first time is worth bonus VP in Seafarers.
    # ----------------------------------------------------
    land_hexes = [h for h in hexes if h['resource'] != 'water']
    edge_to_land = {}
    for h in land_hexes:
        for e_id in h['edges']:
            edge_to_land.setdefault(e_id, []).append(h)
    # Union-Find over land hexes
    parent = {id(h): id(h) for h in land_hexes}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    for shared in edge_to_land.values():
        for i in range(1, len(shared)):
            union(id(shared[0]), id(shared[i]))
    components = {}
    for h in land_hexes:
        components.setdefault(find(id(h)), []).append(h)
    main_root = max(components, key=lambda r: len(components[r])) if components else None
    island_ids = {root: idx for idx, root in enumerate(components.keys())}
    for h in hexes:
        h['island'] = island_ids.get(find(id(h))) if h['resource'] != 'water' else None
    main_island = island_ids.get(main_root) if main_root is not None else None

    return {
        'hexes': hexes,
        'vertices': vertices,
        'edges': edges,
        'ports': ports,
        'mainIsland': main_island,
        'mapId': layout['id']
    }
