# CI/CD & deployment

GitHub Actions (`.github/workflows/ci-cd.yml`) tests every pull request and deploys every push to `main`.

```
pull request / push ─┬─ Backend tests      pytest: engine invariants, checkpoint codec, server smoke (Socket.IO game start)
                     ├─ Frontend           eslint (0 errors) + vite build
                     ├─ Migrations         all supabase/migrations applied to a fresh Postgres + schema checks (RLS on every table)
                     └─ Docker             production image builds
push to main ────────┴─▶ Deploy            supabase db push (new migrations) ─▶ flyctl deploy ─▶ smoke test https://catandabuverse.fly.dev
```

The deploy job runs in the GitHub **environment `production`**. In repo Settings → Environments you can require a reviewer before each deploy.

## Hosting

| Piece | Where |
|---|---|
| Game server + web app | Fly.io app `catandabuverse`, region `sin`, one always-on `shared-cpu-1x` (512 MB) machine. Image built from the `Dockerfile` |
| Database, auth | Supabase project `aeihqbeuqhopxtocelpd` (ap-southeast-1) |

**Deploys keep games alive:** Fly stops the old machine with SIGTERM, which checkpoints every live game and hands it over. The new machine takes the games over within ~10 s (`FAILOVER_INTERVAL_SECONDS`), and players' browsers reconnect automatically.

**Scaling out:** run a second Fly app (or region) with its own `PUBLIC_URL`. Two machines behind *one* Fly app URL would need `fly-replay` routing, which isn't implemented.

## First-time Fly setup (already done for `catandabuverse`)

```bash
fly auth login
fly apps create catandabuverse
fly ips allocate-v4 --shared -a catandabuverse   # without public IPs the domain doesn't resolve
fly ips allocate-v6 -a catandabuverse
fly secrets import --stage -a catandabuverse      # DATABASE_URL, SUPABASE_URL, IP_HASH_SALT
fly tokens create deploy -a catandabuverse        # → GitHub secret FLY_API_TOKEN
```

**Fly trial accounts stop machines after 5 minutes.** Add a card at https://fly.io/trial, then start the machine (`fly machine start -a catandabuverse`, or just redeploy).

**Don't point a dev machine at production.** A server whose `PUBLIC_URL` is `localhost` won't register in the shared server registry when its `DATABASE_URL` is remote. Otherwise players on the live site could be routed to `localhost`. Develop against the local Supabase stack.

## Secrets and variables

| Name | Where | What |
|---|---|---|
| `FLY_API_TOKEN` | GitHub secret | Deploy token for the Fly app (`fly tokens create deploy`) |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret | Supabase personal access token (for `supabase db push`) |
| `SUPABASE_DB_PASSWORD` | GitHub secret | Database password |
| `SUPABASE_PROJECT_REF` | GitHub variable | `aeihqbeuqhopxtocelpd` |
| `DATABASE_URL`, `SUPABASE_URL`, `IP_HASH_SALT` | Fly secrets | Server runtime config (`fly secrets set ...`) |
| `PUBLIC_URL`, `PORT`, `SERVER_REGION`, `FAILOVER_INTERVAL_SECONDS` | `fly.toml` `[env]` | Non-secret runtime config |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `fly.toml` `[build.args]` | Public values baked into the web app |

Rotating a secret: update it in GitHub or with `fly secrets set` (which restarts the machine with a handover).

## Manual operations

```bash
fly status -a catandabuverse          # machines, health
fly logs -a catandabuverse            # live server logs
fly deploy                            # deploy from your machine (same as CI)
gh workflow run ci-cd.yml --ref main  # re-run the pipeline / redeploy
```

Rollback: `fly releases -a catandabuverse`, then `fly deploy --image <previous image>`. Or revert the commit on `main`, which redeploys. Database migrations are forward-only: fix a bad migration with a new one.
