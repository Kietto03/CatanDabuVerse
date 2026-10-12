"""Who is on the other end of a socket: Supabase JWT verification + profile lookups.

Env:
  SUPABASE_URL          e.g. http://127.0.0.1:54321. When set, every socket must
                        present a valid access token (login required).
  SUPABASE_JWT_SECRET   only for projects still on the legacy HS256 secret;
                        otherwise keys come from the project's JWKS endpoint.
  IP_HASH_SALT          salt for hashing client IPs in connection logs.
"""
import asyncio
import hashlib
import os
import ssl

import certifi
import jwt

from . import fetchrow

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
ISSUER = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else None
# Explicit CA bundle: some Python installs (e.g. python.org builds on macOS) ship
# without system root certificates, which makes the HTTPS key fetch fail.
_jwks = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True, lifespan=3600,
                        ssl_context=ssl.create_default_context(cafile=certifi.where())) if ISSUER else None


def auth_required():
    return bool(SUPABASE_URL)


class AuthError(Exception):
    pass


def _decode(token):
    header = jwt.get_unverified_header(token)
    if header.get("alg") == "HS256":
        if not JWT_SECRET:
            raise AuthError("HS256 token but SUPABASE_JWT_SECRET is not set")
        key = JWT_SECRET
    else:
        key = _jwks.get_signing_key_from_jwt(token).key   # fetches/caches the JWKS
    return jwt.decode(
        token, key,
        algorithms=["ES256", "RS256", "HS256"],
        audience="authenticated",
        issuer=ISSUER,
        options={"require": ["exp", "sub"]},
    )


async def verify_token(token):
    """Return the verified claims of a Supabase access token, or raise AuthError."""
    if not token:
        raise AuthError("missing token")
    try:
        # PyJWKClient does blocking HTTP on a cache miss; keep it off the event loop.
        return await asyncio.to_thread(_decode, token)
    except AuthError:
        raise
    except Exception as e:  # noqa: BLE001 - any decode/verify failure is unauthorized
        raise AuthError(str(e)) from e


async def load_profile(user_id):
    return await fetchrow(
        "select display_name, username, is_guest from public.profiles where id = $1::uuid", user_id)


async def active_sanction(user_id, kind):
    """The active ban/mute row for a user, or None."""
    return await fetchrow(
        """select reason, expires_at from public.sanctions
           where user_id = $1::uuid and kind = $2::public.sanction_kind and revoked_at is null
             and (expires_at is null or expires_at > now())
           order by expires_at desc nulls first limit 1""",
        user_id, kind)


def hash_ip(ip):
    if not ip:
        return None
    salt = os.environ.get("IP_HASH_SALT", "")
    return hashlib.sha256((salt + ip).encode()).hexdigest()[:32]
