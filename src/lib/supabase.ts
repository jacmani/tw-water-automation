import { createClient } from '@supabase/supabase-js';
import type { DailySheet, TowerConsumption, WaterSource, WaterLevel, Amenity, Summary, CommitteeMember } from '@/types';

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
    .eq('superseded', false)
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
    .eq('superseded', false)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function wasSheetUploadedToday(todayUtc: string): Promise<boolean> {
  // Use IST date (UTC+5:30) so the boundary is midnight IST, not midnight UTC.
  // Between 00:00–05:30 IST the UTC date is still "yesterday", which would incorrectly
  // show the alert even though the sheet was already uploaded for the IST date.
  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
  const { count } = await supabase
    .from('daily_sheets')
    .select('id', { count: 'exact', head: true })
    .eq('date', todayIST)
    .eq('processed_status', 'processed')
    .eq('superseded', false);
  return (count ?? 0) > 0;
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

// Returns last N days of tower consumption totals per tower per day (non-superseded only).
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
    .eq('superseded', false)
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
    .eq('superseded', false)
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

// ─────────────────────────────────────────
// Committee queries
// ─────────────────────────────────────────

export async function getCommitteeTerms(): Promise<string[]> {
  const { data } = await supabase
    .from('committee_members')
    .select('term')
    .order('term', { ascending: false });
  if (!data) return [];
  return [...new Set(data.map((d) => d.term as string))];
}

export async function getCurrentCommitteeTerm(): Promise<string | null> {
  const terms = await getCommitteeTerms();
  return terms[0] ?? null;
}

export async function getCommitteeMembers(term: string): Promise<CommitteeMember[]> {
  const { data } = await supabase
    .from('committee_members')
    .select('*')
    .eq('term', term)
    .eq('active', true)
    .order('name');
  return (data ?? []) as CommitteeMember[];
}

export async function getAllCommitteeMembers(term: string): Promise<CommitteeMember[]> {
  const { data } = await supabase
    .from('committee_members')
    .select('*')
    .eq('term', term)
    .order('name');
  return (data ?? []) as CommitteeMember[];
}

// Unused imports kept for type exports
export type { WaterSource, WaterLevel, Amenity };

// ─────────────────────────────────────────
// Logbook queries (005_logbook_full_schema)
// ─────────────────────────────────────────

import type {
  DailyLog,
  TowerMeterReading,
  InputSourceReading,
  AmenityMeterReading,
  WaterLevelReading,
  UtilityMeterReading,
  DailyInflowSummary,
  FullLogEntry,
} from '@/types';

export async function getMostRecentLogDate(): Promise<string | null> {
  const { data } = await supabase
    .from('daily_log')
    .select('log_date')
    .order('log_date', { ascending: false })
    .limit(1)
    .single();
  return (data?.log_date as string) ?? null;
}

export async function getLogEntry(date: string): Promise<FullLogEntry | null> {
  const { data: log } = await supabase
    .from('daily_log')
    .select('*')
    .eq('log_date', date)
    .single();

  if (!log) return null;

  const [
    { data: tower_readings },
    { data: source_readings },
    { data: amenity_readings },
    { data: water_levels },
    { data: utility_meters },
    { data: inflow_summary },
  ] = await Promise.all([
    supabase.from('tower_meter_readings').select('*').eq('log_date', date).order('tower').order('meter_type'),
    supabase.from('input_source_readings').select('*').eq('log_date', date),
    supabase.from('amenity_meter_readings').select('*').eq('log_date', date).order('amenity_type').order('location'),
    supabase.from('water_level_readings').select('*').eq('log_date', date).order('time_slot'),
    supabase.from('utility_meter_readings').select('*').eq('log_date', date).single(),
    supabase.from('daily_inflow_summary').select('*').eq('log_date', date).single(),
  ]);

  return {
    log: log as DailyLog,
    tower_readings: (tower_readings ?? []) as TowerMeterReading[],
    source_readings: (source_readings ?? []) as InputSourceReading[],
    amenity_readings: (amenity_readings ?? []) as AmenityMeterReading[],
    water_levels: (water_levels ?? []) as WaterLevelReading[],
    utility_meters: (utility_meters ?? null) as UtilityMeterReading | null,
    inflow_summary: (inflow_summary ?? null) as DailyInflowSummary | null,
  };
}

export async function getDashboardLogbookData(date: string): Promise<{
  inflow: DailyInflowSummary | null;
  latestWaterLevel: WaterLevelReading | null;
  amenities: AmenityMeterReading[];
}> {
  const [
    { data: inflow },
    { data: waterLevels },
    { data: amenities },
  ] = await Promise.all([
    supabase.from('daily_inflow_summary').select('*').eq('log_date', date).single(),
    supabase.from('water_level_readings').select('*').eq('log_date', date),
    supabase.from('amenity_meter_readings').select('*').eq('log_date', date),
  ]);

  // Pick the latest available time slot in chronological order (alphabetic sort on '00:00'
  // would incorrectly treat midnight as the earliest entry rather than the latest).
  const SLOT_ORDER = ['06:00', '12:00', '18:00', '00:00'];
  const levels = (waterLevels ?? []) as WaterLevelReading[];
  const latestWaterLevel = SLOT_ORDER.slice().reverse().reduce<WaterLevelReading | null>(
    (found, slot) => found ?? levels.find((r) => r.time_slot === slot) ?? null,
    null
  );

  return {
    inflow: (inflow ?? null) as DailyInflowSummary | null,
    latestWaterLevel,
    amenities: (amenities ?? []) as AmenityMeterReading[],
  };
}

export async function getLogDates(limit = 30): Promise<string[]> {
  const { data } = await supabase
    .from('daily_log')
    .select('log_date')
    .order('log_date', { ascending: false })
    .limit(limit);
  return (data ?? []).map((d) => d.log_date as string);
}
