# Supabase setup

Requirements: Docker Desktop and Node 18+ (the CLI runs through `npx supabase`, so nothing is installed globally).

## 1. Local stack

```bash
cp supabase/.env.example supabase/.env      # fill OAuth creds if you want to test Google/Discord locally
npx supabase start -x edge-runtime,logflare,vector,imgproxy   # first run pulls images (~a few minutes)
```

`start` applies every file in `supabase/migrations/` in order. It prints:

| Value | Default local |
|---|---|
| API URL | `http://127.0.0.1:54321` |
| DB URL | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (DB GUI) | `http://127.0.0.1:54323` |
| Mailpit (catches auth emails) | `http://127.0.0.1:54324` |
| anon / service_role keys | printed by `npx supabase status` |

Common commands:

```bash
npx supabase status                    # URLs + keys
npx supabase db reset                  # drop & re-apply all migrations (local only)
npx supabase migration new <name>      # new empty migration file
npx supabase stop                      # stop containers (data kept); --no-backup wipes it
```

Locally, email sign-up needs no confirmation. Guest (anonymous) sign-in and identity linking are on.

## 2. Hosted project

1. Create a project at https://supabase.com/dashboard. Pick a region near the players (e.g. Singapore). Save the DB password.
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push            # applies migrations not yet on the hosted DB
   ```
3. **Authentication → Sign In / Providers**
   - Email: enabled, **Confirm email = on**
   - Allow anonymous sign-ins: **on**
   - Allow manual linking: **on** (lets a guest attach Google/Discord/email)
   - Google, Discord: see §3
4. **Authentication → Hooks** → *Customize Access Token (JWT) Claims* → Postgres function `public.custom_access_token_hook`.
5. **Authentication → URL Configuration**: Site URL = the production web address. Add the redirect URLs **with `/**`** so invite links like `/?room=ABCD` survive the redirect: `https://<prod-domain>/**`, `http://localhost:3000/**`.
6. **Authentication → Rate limits**: keep anonymous sign-ins limited (default 30/h per IP) and consider enabling CAPTCHA, since guest accounts can be farmed.
7. `pg_cron` is created by the migrations. Check that the job exists: `select * from cron.job;`.

Steps 3–5 can alternatively be pushed from `config.toml` with `npx supabase config push`. Review its diff before confirming.

## 2b. Frontend

```bash
cp frontend/.env.example frontend/.env.local   # git-ignored
# set VITE_SUPABASE_ANON_KEY from `npx supabase status` (local) or Dashboard → Project Settings → API (hosted)
cd frontend && npm run build                    # values are baked in at build time
```

Leave both variables empty to run without login (the old type-a-name mode).

## 2c. Game server

```bash
cp .env.example .env          # git-ignored; server.py loads it at start
# set DATABASE_URL (local value is prefilled) and SUPABASE_URL
npm start
```

| Variable | Effect |
|---|---|
| `SUPABASE_URL` | Set → every socket must present a valid Supabase access token. Empty → legacy name-only seats |
| `DATABASE_URL` | Set → matches, results, chat and connections are stored. Empty → nothing is stored, games still run |
| `SUPABASE_JWT_SECRET` | Only for projects still on the legacy HS256 signing secret |
| `IP_HASH_SALT` | Salt for the hashed IPs in `connection_sessions` |
| `EMPTY_ROOM_GRACE_SECONDS` | How long a room with no connected humans survives (default 60) |
| `PUBLIC_URL` | This server's address as clients reach it (default `http://localhost:$PORT`). **Must be unique per server** |
| `PORT` | Port used for the default `PUBLIC_URL` (default 3000) |
| `HEARTBEAT_SECONDS` / `FAILOVER_INTERVAL_SECONDS` | Registry heartbeat (15) and takeover check (30) intervals |
| `MAX_ROOMS`, `SERVER_REGION` | Capacity used for placement; label shown on the admin site |
| `EXIT_WHEN_DRAINED` | `1` → a server set to `draining` exits once its last room ends |

### Running several game servers

Each server is a normal `uvicorn server:socket_app` process with its own `PUBLIC_URL`, all sharing `DATABASE_URL`/`SUPABASE_URL`. The web page can be served by any of them (or a CDN); players' sockets are routed to the server that owns their room. No sticky sessions are needed.

- **Deploy without dropping games:** stop a server with SIGTERM. It checkpoints its games and hands them over (players reconnect in a few seconds). Or set `status = 'draining'` and let its games finish first.
- **Crash:** survivors take the games over about 60 s after the last heartbeat; at most the current turn is replayed from its start.

Hosted: use the **Session pooler** connection string (port **5432**) from Dashboard → Connect: IPv4-friendly and compatible with asyncpg's prepared statements. The transaction pooler (port 6543) also works, since the server then turns off its statement cache, but session mode suits long-lived game servers better. Keep the string server-side only.

This project: `postgresql://postgres.aeihqbeuqhopxtocelpd:<DB password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`

### Switching between the local stack and the hosted project

`.env` and `frontend/.env.local` keep the other set of values as `# local stack:` comments. Swap the active lines, then rebuild the frontend (`cd frontend && npm run build`) and restart the server, since the two must point at the same project. A database password with special characters (`@`, `/`, `#`, `%`, ...) must be URL-encoded inside `DATABASE_URL`.

## 3. OAuth providers

The callback URL to register with each provider:
- hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
- local: `http://127.0.0.1:54321/auth/v1/callback`

**Google.** Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application). Add the callback URL(s) above as *Authorized redirect URIs*. Configure the OAuth consent screen (scopes: `email`, `profile`, `openid`).

**Discord.** https://discord.com/developers/applications → New Application → OAuth2. Copy the Client ID / Secret and add the callback URL(s) as Redirects.

Put the credentials in the dashboard (hosted) or in `supabase/.env` (local, git-ignored). Restart with `npx supabase stop && npx supabase start` after editing `.env`.

## 4. First admin

Roles are only granted by users with `role.assign`, so bootstrap the owner once with SQL (Studio → SQL editor, or `psql`):

```sql
insert into public.user_roles (user_id, role_id)
select u.id, r.id from auth.users u, public.roles r
where u.email = 'owner@example.com' and r.key = 'superadmin';
```

The user must sign out and in again (or wait for token refresh) to get the new claims. After that, more staff can be added from the admin site (`/admin` → Kiểm duyệt → search → Cấp quyền).

| Role | Admin site access |
|---|---|
| `moderator` | Moderation: reports, user lookup, mute |
| `admin` | Everything except the audit log: overview, matches & servers (terminate, drain), moderation incl. ban and roles, settings |
| `superadmin` | Everything, incl. the audit log |

## 5. Keys and where they go

| Key | Used by | Secret? |
|---|---|---|
| `anon` / publishable key | Frontend (`VITE_SUPABASE_ANON_KEY`) | No. RLS protects the data |
| `service_role` / secret key, or `DATABASE_URL` | Game server only | **Yes**, never ship it to the browser |
| JWT signing keys / JWKS URL | Game server (verifies socket JWTs) | JWKS is public |

## 6. Verifying a setup

After `db reset` or `db push`, these should hold (they were checked on the local stack on 2026-10-09):
- Anonymous sign-up → JWT has `app_roles = ["guest"]`; email sign-up → `["player"]`
- A `profiles` row is created automatically; users can only edit `username`, `display_name`, `avatar_url`, `country`
- Guest linking an email/OAuth identity becomes `player` with the same `user_id`
- `select * from public.maps` returns 12 rows to anyone; `audit_log` returns nothing to non-admins
- RPC `find_room`, `pick_game_server`, `get_shared_replay` are callable with the anon key; `claim_orphaned_matches`, `build_replay`, `purge_expired_replays` are not
