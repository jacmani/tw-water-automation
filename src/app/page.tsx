import { getMostRecentSheet, wasSheetUploadedToday, getTowerConsumptionForSheet, getSummaryForSheet, getTowerTrend, getMostRecentLogDate, getDashboardLogbookData } from '@/lib/supabase';
import { TOWERS, formatMediumDate } from '@/lib/utils';
import TowerCard from '@/components/dashboard/TowerCard';
import TrendChart from '@/components/dashboard/TrendChart';
import SummaryRow from '@/components/dashboard/SummaryRow';
import MissingSheetAlert from '@/components/dashboard/MissingSheetAlert';
import InfographicPanel from '@/components/dashboard/InfographicPanel';
import ISTClock from '@/components/dashboard/ISTClock';
import InflowSummaryPanel from '@/components/dashboard/InflowSummaryPanel';
import WaterLevelsPanel from '@/components/dashboard/WaterLevelsPanel';
import AmenitiesPanel from '@/components/dashboard/AmenitiesPanel';
import Navbar from '@/components/Navbar';
import type { DashboardData, TrendChartPoint } from '@/types';

export const revalidate = 60;

export default async function Dashboard() {
  const today = new Date().toISOString().split('T')[0];

  const [recentSheet, trendData, hasTodaySheet, recentLogDate] = await Promise.all([
    getMostRecentSheet(),
    getTowerTrend(7),
    wasSheetUploadedToday(today),
    getMostRecentLogDate(),
  ]);
  const sheetDate = recentSheet?.date ?? today;

  let towerConsumption: Awaited<ReturnType<typeof getTowerConsumptionForSheet>> = [];
  let summary: Awaited<ReturnType<typeof getSummaryForSheet>> = null;

  let logbookPanelData: Awaited<ReturnType<typeof getDashboardLogbookData>> = {
    inflow: null, latestWaterLevel: null, amenities: [],
  };

  if (recentSheet) {
    [towerConsumption, summary] = await Promise.all([
      getTowerConsumptionForSheet(recentSheet.id),
      getSummaryForSheet(recentSheet.id),
    ]);
  }
  if (recentLogDate) {
    logbookPanelData = await getDashboardLogbookData(recentLogDate);
  }

  const towers = TOWERS.map((tower) => {
    const doRow = towerConsumption.find((r) => r.tower === tower && r.type === 'DO');
    const drRow = towerConsumption.find((r) => r.tower === tower && r.type === 'DR');
    const totalToday =
      recentSheet ? ((doRow?.total_ltrs ?? 0) + (drRow?.total_ltrs ?? 0)) || null : null;

    const towerTrend = trendData
      .filter((d) => d.tower === tower)
      .map((d) => ({ date: d.date, total: d.total_ltrs }));

    const historicalTotals = towerTrend
      .filter((d) => d.date !== sheetDate)
      .map((d) => d.total);
    const sevenDayAvg =
      historicalTotals.length > 0
        ? historicalTotals.reduce((a, b) => a + b, 0) / historicalTotals.length
        : null;

    const sortedTrend = [...towerTrend].sort((a, b) => b.date.localeCompare(a.date));
    const prevEntry = sortedTrend.find((d) => d.date !== sheetDate);

    return {
      tower,
      today_do: doRow?.total_ltrs ?? null,
      today_dr: drRow?.total_ltrs ?? null,
      total_today: totalToday,
      total_yesterday: prevEntry?.total ?? null,
      seven_day_avg: sevenDayAvg,
      trend: towerTrend,
    };
  });

  const totalConsumption =
    recentSheet
      ? towers.reduce((sum, t) => sum + (t.total_today ?? 0), 0) || null
      : null;

  const dashboardData: DashboardData = {
    date: sheetDate,
    towers,
    total_consumption: totalConsumption,
    input_total: summary?.input_total ?? null,
    diff: summary?.diff ?? null,
    has_sheet: !!recentSheet,
    flagged_fields: [],
  };

  const allDates = Array.from(new Set(trendData.map((d) => d.date))).sort();
  const chartData: TrendChartPoint[] = allDates.map((date) => {
    const point: TrendChartPoint = { date, Venus: null, Mercury: null, Neptune: null, Jupiter: null };
    TOWERS.forEach((tower) => {
      const entry = trendData.find((d) => d.date === date && d.tower === tower);
      if (entry) point[tower] = entry.total_ltrs;
    });
    return point;
  });

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-700 dark:text-slate-300">Dashboard</h1>
        <ISTClock />
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-6">
        <MissingSheetAlert hasSheet={hasTodaySheet} />

        {dashboardData.has_sheet && (
          <SummaryRow
            inputTotal={dashboardData.input_total}
            towerUsage={dashboardData.total_consumption}
            diff={dashboardData.diff}
            sheetDate={dashboardData.date}
          />
        )}

        <section>
          <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Tower Consumption — {formatMediumDate(sheetDate)}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {dashboardData.towers.map((t) => (
              <TowerCard key={t.tower} data={t} />
            ))}
          </div>
        </section>

        {recentLogDate && (
          <>
            <section>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Inflow / Usage — {formatMediumDate(recentLogDate)}
              </p>
              <InflowSummaryPanel data={logbookPanelData.inflow} date={null} />
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <WaterLevelsPanel data={logbookPanelData.latestWaterLevel} />
              <AmenitiesPanel data={logbookPanelData.amenities} />
            </div>
          </>
        )}

        {chartData.length > 0 && (
          <section>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
              7-Day Trend
            </p>
            <TrendChart data={chartData} />
          </section>
        )}

        {dashboardData.has_sheet && (
          <section>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Download Infographics
            </p>
            <InfographicPanel data={dashboardData} />
          </section>
        )}
      </div>
    </main>
  );
}
