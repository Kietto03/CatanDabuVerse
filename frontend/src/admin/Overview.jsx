import { HBars, Legend, LineArea, StackedColumns, StatTile, TableView } from './charts';
import { MODE_LABEL, SERIES, lastDays, q, supabase, useLoad } from './data';
import { ErrorNote, Section } from './parts';

const DAYS = 14;
const MODES = [
  { key: 'basic', label: MODE_LABEL.basic, color: SERIES[0] },
  { key: 'seafarers', label: MODE_LABEL.seafarers, color: SERIES[1] },
  { key: 'cities', label: MODE_LABEL.cities, color: SERIES[2] },
];
const BOT_LABEL = { bot_easy: 'Dễ', bot_medium: 'Vừa', bot_hard: 'Khó', bot_mcts: 'AI (MCTS)' };

async function loadOverview() {
  const days = lastDays(DAYS);
  const since = `${days[0]}T00:00:00Z`;
  const [live, servers, perDay, dau, bots, accounts] = await Promise.all([
    q(supabase.from('v_live_matches').select('id, status')),
    q(supabase.from('v_server_health').select('id, status, is_alive')),
    q(supabase.from('v_matches_per_day').select('day, mode, matches, avg_minutes').gte('day', since)),
    q(supabase.from('v_daily_active_users').select('day, dau').gte('day', since)),
    q(supabase.from('v_bot_winrates').select('bot_type, games, win_rate')),
    q(supabase.from('profiles').select('id', { count: 'exact', head: true })),
  ]);
  return { days, live, servers, perDay, dau, bots, accounts };
}

export default function Overview() {
  const { data, error } = useLoad(loadOverview, [], 15000);
  if (!data) return error ? <ErrorNote error={error} /> : <div className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải…</div>;

  const { days, live, servers, perDay, dau, bots, accounts } = data;
  const byDay = {};
  for (const r of perDay) {
    const d = r.day.slice(0, 10);
    (byDay[d] ||= {})[r.mode] = Number(r.matches);
  }
  const matchesOf = (d, mode) => byDay[d]?.[mode] || 0;
  const dauByDay = Object.fromEntries(dau.map((r) => [r.day.slice(0, 10), Number(r.dau)]));
  const dauPoints = days.map((d) => ({ x: `${d}T00:00:00Z`, y: dauByDay[d] || 0 }));
  const today = days[days.length - 1];
  const todayMatches = MODES.reduce((s, m) => s + matchesOf(today, m.key), 0);
  const alive = servers.filter((s) => s.is_alive && s.status !== 'dead');
  const playing = live.filter((m) => m.status !== 'lobby').length;
  const botRows = bots.filter((b) => b.bot_type).sort((a, b) => b.win_rate - a.win_rate).map((b) => ({
    label: BOT_LABEL[b.bot_type] || b.bot_type, value: Number(b.win_rate) * 100, max: 100,
    note: `${b.games} ván`,
  }));

  return (
    <>
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Ván đang diễn ra" value={playing} sub={`${live.length - playing} phòng chờ`} />
        <StatTile label="Máy chủ hoạt động" value={alive.length}
          sub={alive.some((s) => s.status === 'draining') ? `${alive.filter((s) => s.status === 'draining').length} đang rút` : 'tất cả nhận phòng mới'} />
        <StatTile label="Người chơi hôm nay" value={dauByDay[today] || 0} sub="tài khoản đã kết nối (UTC)" />
        <StatTile label="Ván xong hôm nay" value={todayMatches} sub={`${accounts.toLocaleString('vi-VN')} tài khoản`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title={`Ván hoàn thành theo ngày · ${DAYS} ngày`} right={<Legend items={MODES} />}>
          <StackedColumns days={days} series={MODES} value={matchesOf} ariaLabel="Số ván hoàn thành mỗi ngày theo chế độ" />
          <TableView columns={['Ngày', ...MODES.map((m) => m.label), 'Tổng']}
            rows={days.map((d) => [d, ...MODES.map((m) => matchesOf(d, m.key)), MODES.reduce((s, m) => s + matchesOf(d, m.key), 0)])} />
        </Section>
        <Section title={`Người chơi hoạt động mỗi ngày · ${DAYS} ngày`}>
          <LineArea points={dauPoints} unit=" người chơi" ariaLabel="Số người chơi hoạt động mỗi ngày" />
          <TableView columns={['Ngày', 'Người chơi']} rows={dauPoints.map((p) => [p.x.slice(0, 10), p.y])} />
        </Section>
      </div>

      <Section title="Tỉ lệ thắng của bot (mọi thời điểm)">
        {botRows.length
          ? <HBars rows={botRows} format={(v) => `${v.toFixed(0)}%`} ariaLabel="Tỉ lệ thắng theo loại bot" />
          : <div className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu.</div>}
        <TableView columns={['Bot', 'Số ván', 'Tỉ lệ thắng']}
          rows={bots.filter((b) => b.bot_type).map((b) => [BOT_LABEL[b.bot_type] || b.bot_type, b.games, `${(b.win_rate * 100).toFixed(1)}%`])} />
      </Section>
    </>
  );
}
