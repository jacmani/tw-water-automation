'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { TrendChartPoint, TowerName } from '@/types';
import { TOWER_COLORS, formatShortDate, formatLitres } from '@/lib/utils';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

interface Props {
  data: TrendChartPoint[];
}

function formatYAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-300 font-medium mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="text-white font-medium">
            {entry.value != null ? formatLitres(entry.value) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDayName(dateStr: string): string {
  // dateStr is the raw ISO date from the DB, e.g. "2026-06-15"
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short' }); // "Mon", "Tue", …
}

function XAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string; originalDate?: string } }) {
  if (!payload) return null;
  // payload.value is already the formatted short date ("15 Jun")
  // payload.originalDate carries the raw ISO string for day-name lookup
  const dayName = payload.originalDate ? formatDayName(payload.originalDate) : '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="#64748b" fontSize={11}>
        {payload.value}
      </text>
      <text x={0} y={0} dy={27} textAnchor="middle" fill="#475569" fontSize={10}>
        {dayName}
      </text>
    </g>
  );
}

export default function TrendChart({ data }: Props) {
  const formattedData = data.map((d) => ({
    ...d,
    originalDate: d.date,          // keep raw ISO date for day-name rendering
    date: formatShortDate(d.date), // display label "15 Jun"
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formattedData} margin={{ top: 5, right: 10, left: -10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={(props) => <XAxisTick {...props} payload={{ ...props.payload, originalDate: formattedData.find(d => d.date === props.payload?.value)?.originalDate }} />}
            axisLine={false}
            tickLine={false}
            height={48}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => (
              <span style={{ color: '#94a3b8' }}>{value}</span>
            )}
          />
          {TOWERS.map((tower) => (
            <Line
              key={tower}
              type="monotone"
              dataKey={tower}
              stroke={TOWER_COLORS[tower]}
              strokeWidth={2}
              dot={{ fill: TOWER_COLORS[tower], r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
