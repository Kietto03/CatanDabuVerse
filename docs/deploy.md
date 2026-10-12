# CI/CD & deployment

GitHub Actions (`.github/workflows/ci-cd.yml`) tests every pull request and deploys every push to `main`.

```
pull request / push ─┬─ Backend tests      pytest: engine invariants, checkpoint codec, server smoke (Socket.IO game start)
                     ├─ Frontend           eslint (0 errors) + vite build
                     ├─ Migrations         all supabase/migrations applied to a fresh Postgres + schema checks (RLS on every table)
                     └─ Docker             production image builds
push to main ────────┴─▶ Migrate           supabase db push (new migrations)
                         └─▶ Deploy        Render deploy hook for this commit ─▶ wait until /api/health reports it
                                           (or flyctl deploy when DEPLOY_TARGET=fly)
```

The deploy job runs in the GitHub **environment `production`**. In repo Settings → Environments you can require a reviewer before each deploy.

## Hosting (free)

| Piece | Where | Cost |
|---|---|---|
| Game server + web app | **Render** free web service `catandabuverse` (Singapore), built from the `Dockerfile` via `render.yaml` | $0 |
| Database, auth | Supabase project `aeihqbeuqhopxtocelpd` (ap-southeast-1), free plan | $0 |
| CI/CD | GitHub Actions (public repo) | $0 |

**What "free" means on Render**
- The service **sleeps after 15 minutes with no HTTP requests or WebSocket messages**. The next visitor waits about 1 minute while it wakes. Running games send messages constantly, so a game in progress keeps it awake.
- 750 instance-hours a month, enough for one always-on service. Outbound bandwidth comes from the workspace's included 5 GB/month. A game uses a few MB, and the first page load about 0.5 MB.
- Render may restart a free service at any time. Live games survive that through the checkpoint + takeover path.
- If the limits are exceeded without a card on file, Render suspends the service until the next month.

**Supabase free projects pause after ~7 days without activity.** `.github/workflows/keepalive.yml` reads a public table every 3 days to prevent that.

### First-time Render setup
1. Sign in at https://render.com with GitHub (no card needed) and allow access to this repository.
2. **New → Blueprint →** pick this repo. Render reads `render.yaml` and asks for `DATABASE_URL`: use the session-pooler URL with the URL-encoded password (see `setup/supabase.md`).
3. In the new service: **Settings → Deploy Hook**, copy the URL, then `gh secret set RENDER_DEPLOY_HOOK_URL` and `gh variable set RENDER_URL --body https://<service>.onrender.com`.
4. Add `https://<service>.onrender.com/**` to the Supabase redirect allow-list and make it the Site URL.

From then on, every merge to `main` runs CI, migrates the database, triggers the Render deploy for that commit, and waits until `/api/health` reports the new commit.

## Alternative: Fly.io (paid, always on)

Set the repository variable `DEPLOY_TARGET=fly` to deploy with `fly.toml` instead (needs a card on the Fly account, ~$3–5/month for one machine). The Fly app `catandabuverse` exists but is scaled to **0 machines**, so it costs nothing. The next Fly deploy recreates the machine.

### First-time Fly setup (already done for `catandabuverse`)

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
| `RENDER_DEPLOY_HOOK_URL` | GitHub secret | Render service → Settings → Deploy Hook |
| `RENDER_URL` | GitHub variable | `https://<service>.onrender.com` (used by the post-deploy check) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | GitHub variables | Public values for the keep-alive job |
| `DEPLOY_TARGET` | GitHub variable | unset = Render, `fly` = Fly.io |
| `FLY_API_TOKEN` | GitHub secret | Only for `DEPLOY_TARGET=fly` |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret | Supabase personal access token (for `supabase db push`) |
| `SUPABASE_DB_PASSWORD` | GitHub secret | Database password |
| `SUPABASE_PROJECT_REF` | GitHub variable | `aeihqbeuqhopxtocelpd` |
| `DATABASE_URL` | Render env (secret) / Fly secret | Server database connection |
| `SUPABASE_URL`, `IP_HASH_SALT`, `VITE_*`, `FAILOVER_INTERVAL_SECONDS` | `render.yaml` / `fly.toml` | Non-secret config (`IP_HASH_SALT` is generated by Render) |
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
