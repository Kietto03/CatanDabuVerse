-- CatanDabuVerse — reference data (roles, permissions, config, maps) — required in every environment
-- Design: docs/database/DATA_MODEL.md

insert into public.roles (key, description) values
  ('guest', 'Anonymous player'), ('player', 'Registered player'),
  ('moderator', 'Community moderator'), ('admin', 'Operator'), ('superadmin', 'Owner');

insert into public.permissions (key, description) values
  ('match.create', 'Create rooms'), ('match.join', 'Join rooms'), ('replay.export', 'Download replay files'), ('replay.share', 'Create replay share links'),
  ('chat.send', 'Send chat'), ('chat.delete', 'Delete chat messages'),
  ('user.mute', 'Mute users'), ('user.ban', 'Ban users'),
  ('report.resolve', 'Handle reports'), ('match.view_any', 'View any match/replay'),
  ('match.terminate', 'Force-end a match'), ('map.manage', 'Enable/disable maps'),
  ('monitor.view', 'Access monitoring dashboard'), ('role.assign', 'Grant/revoke roles'),
  ('audit.view', 'Read audit log'), ('*', 'Everything');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p on
  (r.key = 'guest'      and p.key in ('match.create', 'match.join', 'chat.send', 'replay.export', 'replay.share')) or
  (r.key = 'player'     and p.key in ('match.create', 'match.join', 'chat.send', 'replay.export', 'replay.share')) or
  (r.key = 'moderator'  and p.key in ('match.create', 'match.join', 'chat.send', 'replay.export', 'replay.share',
                                      'chat.delete', 'user.mute', 'report.resolve', 'match.view_any')) or
  (r.key = 'admin'      and p.key not in ('*', 'audit.view')) or
  (r.key = 'superadmin' and p.key = '*');

insert into public.app_config (key, value) values
  ('replay_retention_days', '7'),
  ('replay_keyframe_every', '50');

-- Generated from map_layouts.py — keep in sync when adding maps.
insert into public.maps (id, name, description, modes, default_vp, min_players, max_players, sort_order) values
  ('standard', 'Standard', 'Bàn 19 hex cổ điển.', '{basic,cities}', 10, 3, 4, 0),
  ('large', 'Big Board (5–6)', 'Bàn lớn cho 5–6 người (~31 hex).', '{basic,cities}', 10, 5, 6, 1),
  ('new_shores', 'Heading for New Shores', 'Đảo chính + 3 đảo nhỏ ven biển.', '{seafarers}', 14, 3, 4, 2),
  ('four_islands', 'The Four Islands', '4 đảo tương đương, không đảo chính.', '{seafarers}', 14, 3, 4, 3),
  ('fog_island', 'The Fog Island', 'Đảo chính + đảo khám phá + ô vàng.', '{seafarers}', 12, 3, 4, 4),
  ('through_desert', 'Through the Desert', 'Đảo nhà, dải sa mạc, đảo tài nguyên bên kia.', '{seafarers}', 14, 3, 4, 5),
  ('forgotten_tribe', 'The Forgotten Tribe', 'Đảo chính + nhiều đảo nhỏ + ô vàng.', '{seafarers}', 12, 3, 4, 6),
  ('pirate_islands', 'The Pirate Islands', 'Hai bờ đối diện + đảo nhỏ.', '{seafarers}', 12, 3, 4, 7),
  ('new_world', 'New World', 'Cụm đảo ngẫu nhiên (mặc định Seafarers).', '{seafarers}', 13, 3, 4, 8),
  ('cloth_for_catan', 'Cloth for Catan', 'Hai bờ song song + chuỗi đảo nhỏ ở giữa.', '{seafarers}', 14, 3, 4, 9),
  ('wonders', 'The Wonders of Catan', 'Một lục địa lớn giữa biển + 4 đảo nhỏ.', '{seafarers}', 15, 3, 4, 10),
  ('greater_catan', 'Greater Catan', 'Bàn lớn 5–6 người: lục địa chính + phụ + đảo.', '{seafarers}', 15, 5, 6, 11)
on conflict (id) do update set name = excluded.name, description = excluded.description,
  modes = excluded.modes, default_vp = excluded.default_vp, min_players = excluded.min_players,
  max_players = excluded.max_players, sort_order = excluded.sort_order;
