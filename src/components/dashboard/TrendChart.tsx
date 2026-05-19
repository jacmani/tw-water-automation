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
import { TOWER_COLORS, formatShortDate } from '@/lib/utils';

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
            {entry.value != null ? `${entry.value.toLocaleString('en-IN')} L` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({ data }: Props) {
  const formattedData = data.map((d) => ({
    ...d,
    date: formatShortDate(d.date),
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formattedData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
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
