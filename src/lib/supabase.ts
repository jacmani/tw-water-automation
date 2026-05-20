import { createClient } from '@supabase/supabase-js';
import type { DailySheet, TowerConsumption, WaterSource, WaterLevel, Amenity, Summary } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client using service role key (bypasses RLS).
// Only call this from API routes and Server Components — never expose to browser.
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─────────────────────────────────────────
// Dashboard queries
// ─────────────────────────────────────────

export async function getTodaySheet(date: string): Promise<DailySheet | null> {
  const { data } = await supabase
    .from('daily_sheets')
    .select('*')
    .eq('date', date)
    .eq('processed_status', 'processed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function getMostRecentSheet(): Promise<DailySheet | null> {
  const { data } = await supabase
    .from('daily_sheets')
    .select('*')
    .eq('processed_status', 'processed')
    .order('date', { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function getTowerConsumptionForSheet(
  sheetId: string
): Promise<TowerConsumption[]> {
  const { data } = await supabase
    .from('tower_consumption')
    .select('*')
    .eq('sheet_id', sheetId);
  return data ?? [];
}

export async function getSummaryForSheet(sheetId: string): Promise<Summary | null> {
  const { data } = await supabase
    .from('summary')
    .select('*')
    .eq('sheet_id', sheetId)
    .single();
  return data;
}

// Returns last N days of tower consumption totals per tower per day.
export async function getTowerTrend(days: number = 7): Promise<
  { date: string; tower: string; total_ltrs: number }[]
> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_sheets')
    .select(
      `date, tower_consumption(tower, type, total_ltrs)`
    )
    .gte('date', cutoffStr)
    .eq('processed_status', 'processed')
    .order('date', { ascending: true });

  if (!data) return [];

  // Aggregate DO + DR per tower per day
  const map: Record<string, Record<string, number>> = {};
  for (const sheet of data) {
    const dateStr = sheet.date as string;
    if (!map[dateStr]) map[dateStr] = {};
    const rows = sheet.tower_consumption as { tower: string; type: string; total_ltrs: number | null }[];
    for (const row of rows ?? []) {
      if (row.total_ltrs == null) continue;
      map[dateStr][row.tower] = (map[dateStr][row.tower] ?? 0) + row.total_ltrs;
    }
  }

  const result: { date: string; tower: string; total_ltrs: number }[] = [];
  for (const [date, towers] of Object.entries(map)) {
    for (const [tower, total_ltrs] of Object.entries(towers)) {
      result.push({ date, tower, total_ltrs });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// Returns the last 2 days of sheets before `date` for Template A "yesterday / 2 days ago" fields.
export async function getRecentTowerTotals(
  beforeDate: string,
  tower: string,
  limit: number = 2
): Promise<{ date: string; total: number }[]> {
  const { data } = await supabase
    .from('daily_sheets')
    .select(`date, tower_consumption(tower, total_ltrs)`)
    .lt('date', beforeDate)
    .eq('processed_status', 'processed')
    .order('date', { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data
    .map((sheet) => {
      const rows = (sheet.tower_consumption as { tower: string; total_ltrs: number | null }[]) ?? [];
      const total = rows
        .filter((r) => r.tower === tower)
        .reduce((sum, r) => sum + (r.total_ltrs ?? 0), 0);
      return { date: sheet.date as string, total };
    })
    .filter((d) => d.total > 0);
}
