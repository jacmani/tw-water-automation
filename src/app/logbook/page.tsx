import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { getLogEntry, getMostRecentLogDate, getLogDates } from '@/lib/supabase';
import { formatDate, formatMediumDate } from '@/lib/utils';
import PrintButton from '@/components/logbook/PrintButton';
import type {
  TowerMeterReading,
  InputSourceReading,
  AmenityMeterReading,
  WaterLevelReading,
} from '@/types';

export const revalidate = 60;

const SOURCE_LABELS: Record<string, string> = {
  mercury_venus_tanker: 'M+V Tanker',
  jupiter_neptune_tanker: 'J+N Tanker',
  venus_side_well_123: 'Venus Well 1+2+3',
  venus_side_well_4: 'Venus Well 4',
  neptune_side_well_5: 'Neptune Well 5',
  neptune_side_well_6: 'Neptune Well 6',
  open_well: 'Open Well',
};

const LOC_LABELS: Record<string, string> = {
  // Car Wash: DB stores Pascal-case tower names
  Jupiter: 'Jupiter', Mercury: 'Mercury', Venus: 'Venus', Neptune: 'Neptune',
  // Swimming Pool: DB stores "Meter 1" / "Meter 2" / "Meter 3"
  'Meter 1': 'Meter 1', 'Meter 2': 'Meter 2', 'Meter 3': 'Meter 3',
};

// Must match water_level_readings.time_slot CHECK constraint (migration 006 —
// '6AM'/'12PM'/'6PM'/'12AM', not '06:00'-style).
const SLOT_LABELS: Record<string, string> = {
  '6AM': '6 AM', '12PM': '12 PM', '6PM': '6 PM', '12AM': '12 AM',
};

function Val({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-slate-500 dark:text-slate-400">—</span>;
  return <>{v.toLocaleString('en-IN')}</>;
}

function TableHead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c} className="text-left text-slate-500 dark:text-slate-400 text-xs font-semibold py-2 pr-4 whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden print:border-slate-300 print:rounded-none print:mb-4">
      <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2.5 print:bg-slate-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 print:text-slate-700">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="px-4 py-3">{children}</div>
      </div>
    </section>
  );
}

function TowerTable({ rows }: { rows: TowerMeterReading[] }) {
  const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];
  return (
    <table className="w-full text-sm text-slate-700 dark:text-slate-300">
      <TableHead cols={['Tower', 'Type', 'Yest. Reading', 'Today Reading', 'Total (L)', 'Cons. Yest.', 'Cons. Today', 'Diff']} />
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {towers.flatMap((tower) =>
          ['DO', 'DR'].map((mt) => {
            const r = rows.find((x) => x.tower === tower && x.meter_type === mt);
            return (
              <tr key={`${tower}_${mt}`} className="text-xs">
                <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">{tower}</td>
                <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{mt}</td>
                <td className="py-2 pr-4 tabular-nums"><Val v={r?.yesterday_reading} /></td>
                <td className="py-2 pr-4 tabular-nums"><Val v={r?.today_reading} /></td>
                <td className="py-2 pr-4 tabular-nums"><Val v={r?.total_in_ltrs} /></td>
                <td className="py-2 pr-4 tabular-nums"><Val v={r?.consumption_yesterday} /></td>
                <td className="py-2 pr-4 tabular-nums font-semibold text-slate-900 dark:text-white"><Val v={r?.consumption_today} /></td>
                <td className="py-2 pr-4 tabular-nums"><Val v={r?.difference} /></td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function SourceTable({ rows }: { rows: InputSourceReading[] }) {
  const order = ['mercury_venus_tanker', 'jupiter_neptune_tanker', 'venus_side_well_123', 'venus_side_well_4', 'neptune_side_well_5', 'neptune_side_well_6', 'open_well'];
  return (
    <table className="w-full text-sm text-slate-700 dark:text-slate-300">
      <TableHead cols={['Source', 'Yest. Reading', 'Today Reading', 'Cons. Yest.', 'Cons. Today', 'Total']} />
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {order.map((src) => {
          const r = rows.find((x) => x.source_name === src);
          return (
            <tr key={src} className="text-xs">
              <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">{SOURCE_LABELS[src]}</td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.yesterday_reading} /></td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.today_reading} /></td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.consumption_yesterday} /></td>
              <td className="py-2 pr-4 tabular-nums font-semibold text-slate-900 dark:text-white"><Val v={r?.consumption_today} /></td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.total} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AmenityTable({ rows, type, locs }: { rows: AmenityMeterReading[]; type: string; locs: string[] }) {
  return (
    <table className="w-full text-sm text-slate-700 dark:text-slate-300">
      <TableHead cols={['Location', 'Yesterday', 'Today', 'Consumption', 'Cumulative']} />
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {locs.map((loc) => {
          const r = rows.find((x) => x.amenity_type === type && x.location === loc);
          return (
            <tr key={loc} className="text-xs">
              <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">{LOC_LABELS[loc]}</td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.yesterday} /></td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.today} /></td>
              <td className="py-2 pr-4 tabular-nums font-semibold text-slate-900 dark:text-white"><Val v={r?.consumption} /></td>
              <td className="py-2 pr-4 tabular-nums"><Val v={r?.cumulative} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LevelTable({ rows }: { rows: WaterLevelReading[] }) {
  const slots = ['6AM', '12PM', '6PM', '12AM'];
  return (
    <table className="w-full text-sm text-slate-700 dark:text-slate-300">
      <TableHead cols={['Time', 'Jup DO%', 'Jup DR%', 'CT%', 'Mer DO%', 'Mer DR%', 'Cum J', 'Cum M', 'Cum V', 'Cum N', 'Cum Tot']} />
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {slots.map((slot) => {
          const r = rows.find((x) => x.time_slot === slot);
          return (
            <tr key={slot} className="text-xs">
              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">{SLOT_LABELS[slot]}</td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.jupiter_do} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.jupiter_dr} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.collection_tank} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.mercury_do} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.mercury_dr} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.cumulative_j} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.cumulative_m} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.cumulative_v} /></td>
              <td className="py-2 pr-3 tabular-nums"><Val v={r?.cumulative_n} /></td>
              <td className="py-2 pr-3 tabular-nums font-semibold text-slate-900 dark:text-white"><Val v={r?.cumulative_total} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function LogbookPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const [availableDates, recentDate] = await Promise.all([
    getLogDates(30),
    getMostRecentLogDate(),
  ]);

  const selectedDate = searchParams.date ?? recentDate ?? null;
  const entry = selectedDate ? await getLogEntry(selectedDate) : null;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white print:bg-white print:text-slate-900">
      <div className="print:hidden">
        <Navbar />
      </div>
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-1 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-base font-semibold text-slate-700 dark:text-slate-300">Water Consumption Log Book</h1>
          {selectedDate && <p className="text-slate-500 dark:text-slate-400 text-xs">{formatDate(selectedDate)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/upload/logbook"
            className="text-xs border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + Add Entry
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-5">

        {/* Date picker */}
        <div className="flex items-center gap-3 print:hidden">
          <label className="text-slate-500 dark:text-slate-400 text-sm shrink-0">View date:</label>
          <form method="GET" className="flex gap-2">
            <select
              name="date"
              defaultValue={selectedDate ?? ''}
              className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-sm rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>Select a date</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>{formatMediumDate(d)}</option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Go
            </button>
          </form>
          {availableDates.length === 0 && (
            <p className="text-slate-500 dark:text-slate-400 text-sm">No log entries yet.</p>
          )}
        </div>

        {!entry && selectedDate && (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400">
            <p>No log entry found for {formatDate(selectedDate)}.</p>
            <Link href="/upload/logbook" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 text-sm mt-2 block">
              Enter log data →
            </Link>
          </div>
        )}

        {!entry && !selectedDate && (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400">
            <p>No log entries have been entered yet.</p>
            <Link href="/upload/logbook" className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 text-sm mt-2 block">
              Enter today&apos;s log →
            </Link>
          </div>
        )}

        {entry && (
          <>
            {/* Log header info */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 print:border-slate-300">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">Date</p>
                  <p className="text-slate-900 dark:text-white font-semibold">{formatDate(entry.log.log_date)}</p>
                </div>
                {entry.log.technician_name && (
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">Technician</p>
                    <p className="text-slate-900 dark:text-white font-semibold">{entry.log.technician_name}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">FM Sign-off</p>
                  <p className={`font-semibold ${entry.log.fm_signed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {entry.log.fm_signed ? '✓ Signed' : 'Pending'}
                  </p>
                </div>
              </div>
            </div>

            {/* Inflow Summary */}
            {entry.inflow_summary && (
              <SectionCard title="Daily Inflow Summary">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  {[
                    { label: 'Water Inflow', v: entry.inflow_summary.water_inflow },
                    { label: 'Well Inflow', v: entry.inflow_summary.well_inflow },
                    { label: 'Tanker Inflow', v: entry.inflow_summary.tanker_inflow },
                    { label: 'Total Collection', v: entry.inflow_summary.total_collection, bold: true },
                    { label: 'Total Usage', v: entry.inflow_summary.total_usage, bold: true },
                    {
                      label: 'Balance',
                      v: entry.inflow_summary.balance,
                      bold: true,
                      color: entry.inflow_summary.balance != null && entry.inflow_summary.balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
                    },
                  ].map(({ label, v, bold, color }) => (
                    <div key={label}>
                      <p className="text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                      <p className={`text-slate-900 dark:text-white ${bold ? 'font-semibold' : ''} ${color ?? ''} tabular-nums`}>
                        <Val v={v} />
                      </p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Tower Meters */}
            {entry.tower_readings.length > 0 && (
              <SectionCard title="Tower Meter Readings">
                <TowerTable rows={entry.tower_readings} />
              </SectionCard>
            )}

            {/* Input Sources */}
            {entry.source_readings.length > 0 && (
              <SectionCard title="Input Source Readings">
                <SourceTable rows={entry.source_readings} />
              </SectionCard>
            )}

            {/* Car Wash */}
            {entry.amenity_readings.some((r) => r.amenity_type === 'Car Wash') && (
              <SectionCard title="Car Wash Meters">
                <AmenityTable rows={entry.amenity_readings} type="Car Wash" locs={['Jupiter', 'Mercury', 'Venus', 'Neptune']} />

              </SectionCard>
            )}

            {/* Swimming Pool */}
            {entry.amenity_readings.some((r) => r.amenity_type === 'Swimming Pool') && (
              <SectionCard title="Swimming Pool Meters">
                <AmenityTable rows={entry.amenity_readings} type="Swimming Pool" locs={['Meter 1', 'Meter 2', 'Meter 3']} />
              </SectionCard>
            )}

            {/* Water Levels */}
            {entry.water_levels.length > 0 && (
              <SectionCard title="Water Level Readings (%)">
                <LevelTable rows={entry.water_levels} />
              </SectionCard>
            )}

            {/* Utility Meters */}
            {entry.utility_meters && (
              <SectionCard title="Utility Meter Readings">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  {[
                    { label: 'P. Hall Meter 1', v: entry.utility_meters.p_hall_meter_1 },
                    { label: 'P. Hall Meter 2', v: entry.utility_meters.p_hall_meter_2 },
                    { label: 'WTP 1', v: entry.utility_meters.wtp_1 },
                    { label: 'WTP 2', v: entry.utility_meters.wtp_2 },
                    { label: 'Venus Side UF', v: entry.utility_meters.venus_side_uf },
                    { label: 'Total Tankers', v: entry.utility_meters.total_tankers },
                    { label: 'Cons. Yesterday', v: entry.utility_meters.consumption_yesterday },
                    { label: 'Cons. Today', v: entry.utility_meters.consumption_today },
                    { label: 'Cons. Total', v: entry.utility_meters.consumption_total, bold: true },
                  ].map(({ label, v, bold }) => (
                    <div key={label}>
                      <p className="text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                      <p className={`text-slate-900 dark:text-white tabular-nums ${bold ? 'font-semibold' : ''}`}><Val v={v} /></p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Edit link */}
            <div className="text-center pb-4 print:hidden">
              <Link
                href={`/upload/logbook?date=${entry.log.log_date}`}
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                Edit this entry →
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
