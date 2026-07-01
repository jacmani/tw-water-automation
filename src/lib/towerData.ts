import { createClient } from '@supabase/supabase-js';
import { TOWERS, isAboveThreshold } from '@/lib/utils';
import type { TowerDashboardData, TowerName } from '@/types';

// Shared between server components and API routes — always creates its own
// Supabase client so it works without request-scoped context.
function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Returns trend data for the last `days` days (same query as getTowerTrend in
// supabase.ts but self-contained so this module has no circular deps).
async function fetchTrend(
  date: string,
  days: number
): Promise<{ date: string; tower: string; total_ltrs: number }[]> {
  const supabase = makeClient();
  const cutoff = new Date(date + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_sheets')
    .select('date, tower_consumption(tower, type, total_ltrs)')
    .gte('date', cutoffStr)
    .lte('date', date)
    .eq('processed_status', 'processed')
    .eq('superseded', false)
    .order('date', { ascending: true });

  if (!data) return [];

  const map: Record<string, Record<string, number>> = {};
  for (const sheet of data) {
    const d = sheet.date as string;
    if (!map[d]) map[d] = {};
    const rows = sheet.tower_consumption as { tower: string; type: string; total_ltrs: number | null }[];
    for (const row of rows ?? []) {
      if (row.total_ltrs == null) continue;
      map[d][row.tower] = (map[d][row.tower] ?? 0) + row.total_ltrs;
    }
  }

  const result: { date: string; tower: string; total_ltrs: number }[] = [];
  for (const [d, towers] of Object.entries(map)) {
    for (const [tower, total_ltrs] of Object.entries(towers)) {
      result.push({ date: d, tower, total_ltrs });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// Main export: assembles TowerDashboardData[] for a given date. Used by
// app/page.tsx (via dashboard) and /api/poster-data (for the upload share).
export async function getTowerDashboardData(date: string): Promise<TowerDashboardData[]> {
  const trendData = await fetchTrend(date, 8); // 8 days so today + 7 prior

  return TOWERS.map((tower) => {
    const towerTrend = trendData
      .filter((d) => d.tower === tower)
      .map((d) => ({ date: d.date, total: d.total_ltrs }));

    const today = towerTrend.find((d) => d.date === date);
    const totalToday = today?.total ?? null;

    const historicalTotals = towerTrend
      .filter((d) => d.date !== date)
      .map((d) => d.total);

    const sevenDayAvg =
      historicalTotals.length > 0
        ? historicalTotals.reduce((a, b) => a + b, 0) / historicalTotals.length
        : null;

    const sortedTrend = [...towerTrend].sort((a, b) => b.date.localeCompare(a.date));
    const prevEntry = sortedTrend.find((d) => d.date !== date);

    return {
      tower,
      today_do: null,  // not available without per-type breakdown; not needed for poster
      today_dr: null,
      total_today: totalToday,
      total_yesterday: prevEntry?.total ?? null,
      seven_day_avg: sevenDayAvg,
      trend: towerTrend,
    };
  });
}

// Poster-data shape returned by /api/poster-data
export interface PosterTowerData {
  tower: TowerName;
  total_today: number | null;
  total_yesterday: number | null;
  seven_day_avg: number | null;
  isAnomaly: boolean;
}

export function buildPosterData(towers: TowerDashboardData[]): PosterTowerData[] {
  return towers.map((t) => ({
    tower: t.tower,
    total_today: t.total_today,
    total_yesterday: t.total_yesterday,
    seven_day_avg: t.seven_day_avg,
    isAnomaly: isAboveThreshold(t.total_today, t.seven_day_avg, 15),
  }));
}
