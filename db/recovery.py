"""Lossless JSON encoding of a live server room, for crash-recovery checkpoints.

Plain JSON would turn sets into errors and int dict keys (e.g.
`discardsPending[player_index]`) into strings, which silently breaks game
logic after a restore. Non-JSON shapes are tagged and restored exactly.
"""

# Runtime-only keys: recorder buffers and the like are rebuilt after a restore.
_SKIP_ROOM_KEYS = {"_replay"}


def _enc(v):
    if isinstance(v, dict):
        if all(isinstance(k, str) for k in v):
            return {k: _enc(x) for k, x in v.items()}
        return {"__dict__": [[_enc(k), _enc(x)] for k, x in v.items()]}
    if isinstance(v, (list,)):
        return [_enc(x) for x in v]
    if isinstance(v, tuple):
        return {"__tuple__": [_enc(x) for x in v]}
    if isinstance(v, (set, frozenset)):
        return {"__set__": [_enc(x) for x in v]}
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    raise TypeError(f"cannot checkpoint value of type {type(v).__name__}")


def _dec(v):
    if isinstance(v, list):
        return [_dec(x) for x in v]
    if isinstance(v, dict):
        if len(v) == 1:
            (tag, inner), = v.items()
            if tag == "__dict__":
                return {_dec(k): _dec(x) for k, x in inner}
            if tag == "__tuple__":
                return tuple(_dec(x) for x in inner)
            if tag == "__set__":
                return {_dec(x) for x in inner}
        return {k: _dec(x) for k, x in v.items()}
    return v


def encode_room(room):
    return _enc({k: v for k, v in room.items() if k not in _SKIP_ROOM_KEYS})


def decode_room(data):
    return _dec(data)
