-- CatanDabuVerse — identity, IAM (RBAC), auth hooks
-- Design: docs/database/DATA_MODEL.md

-- =====================================================================
-- IDENTITY
-- =====================================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      extensions.citext not null unique
                check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name  text not null check (char_length(display_name) between 1 and 32),
  avatar_url    text,
  country       char(2),
  is_guest      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table public.user_settings (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  preferred_color  text,
  sound_enabled    boolean not null default true,
  reduced_motion   boolean not null default false,
  locale           text not null default 'vi',
  updated_at       timestamptz not null default now()
);

-- =====================================================================
-- IAM (RBAC)
-- =====================================================================
create table public.roles (
  id           smallserial primary key,
  key          text not null unique,          -- 'player', 'guest', 'moderator', 'admin', 'superadmin'
  description  text,
  is_system    boolean not null default true
);

create table public.permissions (
  key          text primary key,              -- 'match.create', 'user.ban', 'monitor.view', ...
  description  text
);

create table public.role_permissions (
  role_id         smallint not null references public.roles(id) on delete cascade,
  permission_key  text     not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  user_id     uuid     not null references public.profiles(id) on delete cascade,
  role_id     smallint not null references public.roles(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  primary key (user_id, role_id)
);

create table public.sanctions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        public.sanction_kind not null,
  reason      text not null,
  issued_by   uuid references public.profiles(id) on delete set null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,                    -- null = permanent
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null
);
create index sanctions_active_idx on public.sanctions (user_id) where revoked_at is null;

-- =====================================================================
-- AUTH INTEGRATION
-- =====================================================================
-- 1) Create profile + default role on signup.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := case when new.is_anonymous then 'guest' else 'player' end;
  -- Google sends name/full_name; Discord sends full_name/name (global name);
  -- email sign-up and guests pass {name} from the client.
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''),
                          nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                          nullif(trim(new.raw_user_meta_data->>'preferred_username'), ''),
                          'Player');
begin
  insert into public.profiles (id, username, display_name, avatar_url, is_guest)
  values (new.id,
          'u_' || substr(replace(new.id::text, '-', ''), 1, 12),  -- user renames later
          left(v_name, 32),
          new.raw_user_meta_data->>'avatar_url',
          new.is_anonymous);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.user_roles (user_id, role_id)
  select new.id, id from public.roles where key = v_role;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 1b) Guest upgrades to a real account (linked Google/Discord/email): same
--     user_id, so history is kept; swap the guest role for player.
create function public.handle_guest_upgrade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set is_guest = false, updated_at = now() where id = new.id;
  delete from public.user_roles ur using public.roles r
  where ur.role_id = r.id and r.key = 'guest' and ur.user_id = new.id;
  insert into public.user_roles (user_id, role_id)
  select new.id, id from public.roles where key = 'player'
  on conflict do nothing;
  insert into public.audit_log (actor_id, action, target_type, target_id)
  values (new.id, 'auth.guest_upgraded', 'user', new.id::text);
  return new;
end $$;

create trigger on_auth_user_upgraded
  after update of is_anonymous on auth.users
  for each row when (old.is_anonymous and not new.is_anonymous)
  execute function public.handle_guest_upgrade();

-- 2) Custom Access Token Hook: put roles + permissions into the JWT.
--    Enable in Dashboard → Authentication → Hooks.
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
declare
  claims jsonb := event->'claims';
  v_uid  uuid  := (event->>'user_id')::uuid;
  v_roles jsonb;
  v_perms jsonb;
begin
  select coalesce(jsonb_agg(distinct r.key), '[]'),
         coalesce(jsonb_agg(distinct rp.permission_key) filter (where rp.permission_key is not null), '[]')
    into v_roles, v_perms
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = r.id
  where ur.user_id = v_uid and (ur.expires_at is null or ur.expires_at > now());

  claims := jsonb_set(claims, '{app_roles}', v_roles);
  claims := jsonb_set(claims, '{app_permissions}', v_perms);
  return jsonb_set(event, '{claims}', claims);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on public.user_roles, public.roles, public.role_permissions to supabase_auth_admin;

-- 3) RLS helper: does the caller's JWT carry this permission?
create function public.authorize(p_permission text) returns boolean
language sql stable as $$
  select coalesce(auth.jwt()->'app_permissions', '[]'::jsonb) ? p_permission
      or coalesce(auth.jwt()->'app_permissions', '[]'::jsonb) ? '*';
$$;
