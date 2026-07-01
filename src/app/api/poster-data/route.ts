import { NextRequest, NextResponse } from 'next/server';
import { getTowerDashboardData, buildPosterData } from '@/lib/towerData';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const towers = await getTowerDashboardData(date);
  const posterTowers = buildPosterData(towers);

  const communityTotal = posterTowers.reduce((s, t) => s + (t.total_today ?? 0), 0) || null;
  const communityYesterday = posterTowers.every((t) => t.total_yesterday != null)
    ? posterTowers.reduce((s, t) => s + (t.total_yesterday ?? 0), 0)
    : null;

  return NextResponse.json({ date, towers: posterTowers, communityTotal, communityYesterday });
}
