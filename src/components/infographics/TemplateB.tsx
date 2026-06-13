'use client';

import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { TowerDashboardData, TowerName } from '@/types';
import { TOWER_COLORS, TOWER_COLORS_LIGHT, formatLitresFull, formatMediumDate } from '@/lib/utils';

const WA_PATH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

interface Props {
  towers: TowerDashboardData[];
  date: string;
  totalConsumption: number | null;
  animProgress?: number; // 0–1; 1 = fully rendered (static/PNG mode)
}

function renderCustomLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent, name,
}: {
  cx: number; cy: number; midAngle: number; innerRadius: number;
  outerRadius: number; percent: number; name: string;
}) {
  if (percent < 0.07) return null;
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

export default function TemplateB({ towers, date, totalConsumption, animProgress = 1 }: Props) {
  const p = Math.max(0, Math.min(1, animProgress));

  const data = towers
    .filter((t) => (t.total_today ?? 0) > 0)
    .map((t) => ({
      name: t.tower as TowerName,
      value: t.total_today ?? 0,
    }));

  const sorted = [...towers].sort((a, b) => (b.total_today ?? 0) - (a.total_today ?? 0));
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  // Pie draws in from top (startAngle 90 → endAngle shrinks as p increases)
  const pieEnd = 90 - 360 * p;
  const animatedTotal = totalConsumption != null ? Math.floor(totalConsumption * p) : null;

  // Ken Burns: starts neutral, slowly zooms in
  const bgScale = 1.0 + 0.06 * p;

  return (
    <div
      style={{
        width: 400,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        background: '#0F172A',
        color: '#fff',
      }}
    >
      {/* Background photo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/tw-2.jpg"
        alt=""
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
        }}
      />
      {/* Dark overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.82)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* Header */}
        <div style={{ background: 'rgba(30, 58, 138, 0.90)', padding: '20px 24px 16px', backdropFilter: 'blur(4px)' }}>
          <p style={{ color: '#BFDBFE', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            TRINITY WORLD WATER
          </p>
          <p style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '4px 0 0', letterSpacing: '-0.01em' }}>
            Tower Wise Distribution
          </p>
          <p style={{ color: '#93C5FD', fontSize: 12, margin: '4px 0 0' }}>{formatMediumDate(date)}</p>
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
                label={p >= 0.98 ? renderCustomLabel : undefined}
                startAngle={90}
                endAngle={pieEnd}
                isAnimationActive={false}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={TOWER_COLORS[entry.name]} />
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
            const animatedVal = total != null ? Math.floor(total * p) : null;
            const pct =
              total != null && (totalConsumption ?? 0) > 0
                ? ((total / totalConsumption!) * 100).toFixed(1)
                : null;
            return (
              <div
                key={t.tower}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
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
                <p style={{ color: TOWER_COLORS_LIGHT[t.tower], fontSize: 14, fontWeight: 700, margin: 0, flex: 1 }}>
                  {t.tower}
                </p>
                <p style={{ color: '#CBD5E1', fontSize: 13, margin: 0 }}>
                  {formatLitresFull(animatedVal)}
                </p>
                {pct && (
                  <p
                    style={{
                      color: '#93C5FD',
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

        {/* Highest / Lowest callouts */}
        <div style={{ padding: '0 24px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {highest?.total_today != null && (
            <div
              style={{
                background: 'rgba(127, 29, 29, 0.60)',
                border: '1px solid #991b1b',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <p style={{ color: '#FCA5A5', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 3px' }}>
                Highest
              </p>
              <p style={{ color: '#fff', fontSize: 14, fontWeight: 800, margin: 0 }}>{highest.tower}</p>
              <p style={{ color: '#CBD5E1', fontSize: 11, margin: '2px 0 0' }}>
                {formatLitresFull(highest.total_today)}
              </p>
            </div>
          )}
          {lowest?.total_today != null && (
            <div
              style={{
                background: 'rgba(5, 150, 105, 0.20)',
                border: '1px solid #059669',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <p style={{ color: '#6EE7B7', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 3px' }}>
                Lowest
              </p>
              <p style={{ color: '#fff', fontSize: 14, fontWeight: 800, margin: 0 }}>{lowest.tower}</p>
              <p style={{ color: '#CBD5E1', fontSize: 11, margin: '2px 0 0' }}>
                {formatLitresFull(lowest.total_today)}
              </p>
            </div>
          )}
        </div>

        {/* Total */}
        <div
          style={{
            background: 'rgba(30, 58, 138, 0.90)',
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <p style={{ color: '#BFDBFE', fontSize: 12, fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Total Community
          </p>
          <p style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>
            {formatLitresFull(animatedTotal)}
          </p>
        </div>

        {/* WhatsApp + Call CTA */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            borderTop: '2px solid rgba(30, 58, 138, 0.60)',
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d={WA_PATH} fill="#25D366" />
              </svg>
              <span style={{ color: '#25D366', fontSize: 13, fontWeight: 700 }}>9072624550</span>
            </div>
            <span style={{ color: '#64748B', fontSize: 10, letterSpacing: '0.04em' }}>Report a Leak</span>
          </div>

          <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.12)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d={PHONE_PATH} fill="#60A5FA" />
              </svg>
              <span style={{ color: '#60A5FA', fontSize: 13, fontWeight: 700 }}>9072624550</span>
            </div>
            <span style={{ color: '#64748B', fontSize: 10, letterSpacing: '0.04em' }}>Call Maintenance</span>
          </div>
        </div>
      </div>
    </div>
  );
}
