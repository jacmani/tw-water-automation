import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendWeeklyReport } from '@/lib/email';
import type { TowerName } from '@/types';

// Vercel Cron — runs Monday 08:00 IST = Monday 02:30 UTC
// Protected by CRON_SECRET header (Vercel injects Authorization: Bearer <CRON_SECRET>)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();

  // Last 7 days (Mon–Sun of the previous week relative to today)
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() - 1); // yesterday
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);

  const fmtDate = (d: Date) => d.toISOString().split('T')[0];
  const weekStartStr = fmtDate(weekStart);
  const weekEndStr = fmtDate(weekEnd);

  // Sheets in range
  const { data: sheets } = await supabase
    .from('daily_sheets')
    .select('id, date')
    .gte('date', weekStartStr)
    .lte('date', weekEndStr)
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const sheetIds = (sheets ?? []).map((s) => s.id);

  // Tower consumption for these sheets
  const { data: towerRows } = await supabase
    .from('tower_consumption')
    .select('tower, type, total_ltrs, sheet_id')
    .in('sheet_id', sheetIds.length > 0 ? sheetIds : ['00000000-0000-0000-0000-000000000000']);

  // Aggregate per tower
  const towerMap: Record<string, number> = {};
  let communityTotal = 0;
  for (const row of towerRows ?? []) {
    if (row.total_ltrs == null) continue;
    towerMap[row.tower] = (towerMap[row.tower] ?? 0) + row.total_ltrs;
    communityTotal += row.total_ltrs;
  }

  const towerTotals = Object.entries(towerMap).map(([tower, total]) => ({ tower, total }));

  // Previous week total for comparison
  const prevEnd = new Date(weekStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - 6);

  const { data: prevSheets } = await supabase
    .from('daily_sheets')
    .select('id')
    .gte('date', fmtDate(prevStart))
    .lte('date', fmtDate(prevEnd))
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const prevSheetIds = (prevSheets ?? []).map((s) => s.id);

  let prevWeekTotal: number | null = null;
  if (prevSheetIds.length > 0) {
    const { data: prevRows } = await supabase
      .from('tower_consumption')
      .select('total_ltrs')
      .in('sheet_id', prevSheetIds);
    prevWeekTotal = (prevRows ?? []).reduce((sum, r) => sum + (r.total_ltrs ?? 0), 0);
  }

  // Spikes this week from alert_log
  const { data: spikeAlerts } = await supabase
    .from('alert_log')
    .select('tower, sheet_date, details')
    .eq('alert_type', 'spike')
    .gte('sheet_date', weekStartStr)
    .lte('sheet_date', weekEndStr)
    .eq('status', 'sent');

  const spikesThisWeek = (spikeAlerts ?? []).map((a) => ({
    tower: a.tower as string,
    date: a.sheet_date as string,
    pct: (a.details as { overagePct?: number })?.overagePct ?? 0,
  }));

  try {
    await sendWeeklyReport(supabase, {
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      towerTotals,
      communityTotal,
      prevWeekTotal,
      spikesThisWeek,
    });
    return NextResponse.json({ success: true, weekStart: weekStartStr, weekEnd: weekEndStr });
  } catch (err) {
    console.error('Weekly report failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
