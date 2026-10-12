-- CatanDabuVerse — extensions & enum types
-- Design: docs/database/DATA_MODEL.md

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- ENUMS
-- =====================================================================
create type public.game_mode      as enum ('basic', 'seafarers', 'cities');
create type public.match_status   as enum ('lobby', 'setup', 'playing', 'finished', 'abandoned', 'terminated');
create type public.seat_kind      as enum ('human', 'bot');
create type public.sanction_kind  as enum ('ban', 'mute');
create type public.report_status  as enum ('open', 'in_review', 'resolved', 'dismissed');
create type public.friend_status  as enum ('pending', 'accepted', 'blocked');
create type public.server_status  as enum ('active', 'draining', 'dead');
