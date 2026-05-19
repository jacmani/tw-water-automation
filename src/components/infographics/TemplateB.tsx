'use client';

import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { TowerDashboardData, TowerName } from '@/types';
import { TOWER_COLORS, formatLitresFull, formatDate } from '@/lib/utils';

interface Props {
  towers: TowerDashboardData[];
  date: string;
  totalConsumption: number | null;
}

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function TemplateB({ towers, date, totalConsumption }: Props) {
  const data = towers
    .filter((t) => (t.total_today ?? 0) > 0)
    .map((t) => ({
      name: t.tower as TowerName,
      value: t.total_today ?? 0,
    }));

  const sorted = [...towers].sort(
    (a, b) => (b.total_today ?? 0) - (a.total_today ?? 0)
  );
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  return (
    <div
      style={{
        width: 400,
        background: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ background: '#1E3A8A', padding: '20px 24px 16px' }}>
        <p style={{ color: '#BFDBFE', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
          TRINITY WORLD WATER
        </p>
        <p style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '4px 0 0', letterSpacing: '-0.01em' }}>
          Tower Wise Distribution
        </p>
        <p style={{ color: '#93C5FD', fontSize: 12, margin: '4px 0 0' }}>{formatDate(date)}</p>
      </div>

      {/* Pie chart */}
      <div style={{ padding: '16px 0 0', display: 'flex', justifyContent: 'center' }}>
        {data.length > 0 ? (
          <PieChart width={360} height={240}>
            <Pie
              data={data}
              cx={175}
              cy={115}
              outerRadius={105}
              dataKey="value"
              labelLine={false}
              label={renderCustomLabel}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={TOWER_COLORS[entry.name]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [formatLitresFull(value), '']}
              contentStyle={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#fff',
                fontSize: 12,
              }}
            />
          </PieChart>
        ) : (
          <div style={{ height: 240, display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: 14 }}>
            No data available
          </div>
        )}
      </div>

      {/* Legend with values */}
      <div style={{ padding: '4px 24px 16px' }}>
        {towers.map((t) => {
          const total = t.total_today;
          const pct = total != null && (totalConsumption ?? 0) > 0
            ? ((total / totalConsumption!) * 100).toFixed(1)
            : null;
          return (
            <div
              key={t.tower}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid #F1F5F9',
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: TOWER_COLORS[t.tower],
                  flexShrink: 0,
                }}
              />
              <p style={{ color: '#1E293B', fontSize: 14, fontWeight: 600, margin: 0, flex: 1 }}>
                {t.tower}
              </p>
              <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>
                {formatLitresFull(total)}
              </p>
              {pct && (
                <p
                  style={{
                    color: '#1E3A8A',
                    fontSize: 12,
                    fontWeight: 700,
                    margin: 0,
                    minWidth: 40,
                    textAlign: 'right',
                  }}
                >
                  {pct}%
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Callouts */}
      <div style={{ padding: '0 24px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {highest?.total_today != null && (
          <div
            style={{
              background: '#FEF2F2',
              borderLeft: '3px solid #DC2626',
              borderRadius: '0 8px 8px 0',
              padding: '10px 12px',
            }}
          >
            <p style={{ color: '#DC2626', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 3px' }}>
              Highest
            </p>
            <p style={{ color: '#1E293B', fontSize: 14, fontWeight: 800, margin: 0 }}>{highest.tower}</p>
            <p style={{ color: '#64748B', fontSize: 11, margin: '2px 0 0' }}>
              {formatLitresFull(highest.total_today)}
            </p>
          </div>
        )}
        {lowest?.total_today != null && (
          <div
            style={{
              background: '#F0FDF4',
              borderLeft: '3px solid #16A34A',
              borderRadius: '0 8px 8px 0',
              padding: '10px 12px',
            }}
          >
            <p style={{ color: '#16A34A', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 3px' }}>
              Lowest
            </p>
            <p style={{ color: '#1E293B', fontSize: 14, fontWeight: 800, margin: 0 }}>{lowest.tower}</p>
            <p style={{ color: '#64748B', fontSize: 11, margin: '2px 0 0' }}>
              {formatLitresFull(lowest.total_today)}
            </p>
          </div>
        )}
      </div>

      {/* Total */}
      <div style={{ background: '#1E3A8A', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ color: '#BFDBFE', fontSize: 12, fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Total Community
        </p>
        <p style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>
          {formatLitresFull(totalConsumption)}
        </p>
      </div>
    </div>
  );
}
