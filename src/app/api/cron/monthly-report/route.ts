import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendMonthlyReport } from '@/lib/email';

// Vercel Cron — runs 1st of month 08:00 IST = 1st of month 02:30 UTC
// Protected by CRON_SECRET header (Vercel injects Authorization: Bearer <CRON_SECRET>)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();

  // Previous calendar month
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);

  const fmtDate = (d: Date) => d.toISOString().split('T')[0];
  const monthStart = fmtDate(firstOfPrevMonth);
  const monthEnd = fmtDate(lastOfPrevMonth);

  const monthLabel = lastOfPrevMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Sheets in month
  const { data: sheets } = await supabase
    .from('daily_sheets')
    .select('id')
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const sheetIds = (sheets ?? []).map((s) => s.id);

  // Tower consumption
  const { data: towerRows } = await supabase
    .from('tower_consumption')
    .select('tower, total_ltrs')
    .in('sheet_id', sheetIds.length > 0 ? sheetIds : ['00000000-0000-0000-0000-000000000000']);

  const towerMap: Record<string, number> = {};
  let communityTotal = 0;
  for (const row of towerRows ?? []) {
    if (row.total_ltrs == null) continue;
    towerMap[row.tower] = (towerMap[row.tower] ?? 0) + row.total_ltrs;
    communityTotal += row.total_ltrs;
  }
  const towerTotals = Object.entries(towerMap).map(([tower, total]) => ({ tower, total }));

  // Previous month total
  const firstOfTwoMonthsAgo = new Date(firstOfPrevMonth.getFullYear(), firstOfPrevMonth.getMonth() - 1, 1);
  const lastOfTwoMonthsAgo = new Date(firstOfPrevMonth.getTime() - 1);

  const { data: prevSheets } = await supabase
    .from('daily_sheets')
    .select('id')
    .gte('date', fmtDate(firstOfTwoMonthsAgo))
    .lte('date', fmtDate(lastOfTwoMonthsAgo))
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  let prevMonthTotal: number | null = null;
  if ((prevSheets ?? []).length > 0) {
    const { data: prevRows } = await supabase
      .from('tower_consumption')
      .select('total_ltrs')
      .in('sheet_id', prevSheets!.map((s) => s.id));
    prevMonthTotal = (prevRows ?? []).reduce((sum, r) => sum + (r.total_ltrs ?? 0), 0);
  }

  // Spike count for the month
  const { count: spikeDays } = await supabase
    .from('alert_log')
    .select('id', { count: 'exact', head: true })
    .eq('alert_type', 'spike')
    .gte('sheet_date', monthStart)
    .lte('sheet_date', monthEnd)
    .eq('status', 'sent');

  try {
    await sendMonthlyReport(supabase, {
      month: monthLabel,
      towerTotals,
      communityTotal,
      prevMonthTotal,
      spikeDays: spikeDays ?? 0,
    });
    return NextResponse.json({ success: true, month: monthLabel });
  } catch (err) {
    console.error('Monthly report failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
