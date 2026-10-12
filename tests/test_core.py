"""Fast checks that need no database: game engine invariants and the
crash-recovery checkpoint codec."""
import json

from bot_ai import selfplay
from db.recovery import decode_room, encode_room


def test_engine_is_deterministic():
    selfplay.sanity_determinism()


def test_engine_conserves_resources():
    selfplay.sanity_conservation()


def test_checkpoint_codec_roundtrip():
    # Shapes the live room really contains: int-keyed dicts (discardsPending),
    # sets (discoveredIslands), tuples, nested lists of dicts.
    room = {
        'code': 'ABCD',
        'discardsPending': {0: 4, 2: 3},
        'discoveredIslands': {1, 3},
        'robberHex': {'q': 0, 'r': 1},
        'pair': (1, 2),
        'slots': [{'index': 0, 'resources': {'wood': 1}}, {'index': 1, 'goldPending': {3: 1}}],
        '_replay': {'not': 'persisted'},
    }
    restored = decode_room(json.loads(json.dumps(encode_room(room))))
    expected = {k: v for k, v in room.items() if k != '_replay'}
    assert restored == expected
    assert isinstance(restored['discoveredIslands'], set)
    assert list(restored['discardsPending']) == [0, 2]
