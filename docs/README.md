# CatanDabuVerse — Documentation

| Document | What's in it |
|---|---|
| [architecture.md](architecture.md) | How the system fits together today and after the Supabase move: game server, frontend, bots, database, auth |
| [database/DATA_MODEL.md](database/DATA_MODEL.md) | Data model & identity design: tables, ERD, IAM (roles/permissions), replays, multi-server, RLS matrix, decisions |
| [roadmap.md](roadmap.md) | The 6-step implementation plan with per-step checklists and status |
| [setup/supabase.md](setup/supabase.md) | Running Supabase locally, configuring Google/Discord/email/guest login, deploying migrations to the hosted project, bootstrapping the first admin |

Code that these docs describe:

| Path | Role |
|---|---|
| `supabase/config.toml` | Local Supabase stack + Auth settings (providers, guest sign-in, access-token hook) |
| `supabase/migrations/` | **Source of truth for the database schema**, applied in filename order |
| `server.py`, `rules.py`, `map_layouts.py` | Authoritative game server |
| `bot_ai/` | Headless engine + MCTS bot |
| `frontend/` | React client |

Conventions:
- A schema change is a **new** migration file (`npx supabase migration new <name>`). Never edit a migration that has already been applied to the hosted project.
- When a design decision changes, update `database/DATA_MODEL.md` §9 (Decisions) in the same commit.
