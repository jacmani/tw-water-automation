import type { TowerDashboardData } from '@/types';
import { TOWER_COLORS, TOWER_COLORS_LIGHT, formatLitresFull, formatDate, percentageDiff } from '@/lib/utils';

const TIPS = [
  'Fix dripping taps — one drip wastes 20,000 L per year.',
  'Run washing machines and dishwashers on full loads only.',
  'Spot a leak? Report it to maintenance immediately.',
];

interface Props {
  tower: TowerDashboardData;
  date: string;
}

export default function TemplateA({ tower, date }: Props) {
  const color = TOWER_COLORS[tower.tower];
  const colorLight = TOWER_COLORS_LIGHT[tower.tower];
  const phone = process.env.NEXT_PUBLIC_TECHNICIAN_PHONE ?? '+91 XXXXX XXXXX';

  // Pull out historical entries sorted desc
  const sortedTrend = [...tower.trend].sort((a, b) => b.date.localeCompare(a.date));
  const todayEntry = sortedTrend.find((d) => d.date === date);
  const pastEntries = sortedTrend.filter((d) => d.date !== date).slice(0, 2);

  const displayToday = tower.total_today ?? todayEntry?.total ?? null;
  const displayYesterday = tower.total_yesterday ?? pastEntries[0]?.total ?? null;
  const displayDayBefore = pastEntries[1]?.total ?? null;
  const diffPct =
    displayToday != null && tower.seven_day_avg != null && tower.seven_day_avg > 0
      ? percentageDiff(displayToday, tower.seven_day_avg)
      : null;

  return (
    <div
      style={{
        width: 400,
        background: '#0F172A',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        padding: 0,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Color accent bar */}
      <div style={{ background: color, height: 6 }} />

      {/* Header */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ color: '#94A3B8', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
              TRINITY WORLD WATER
            </p>
            <p style={{ color: '#CBD5E1', fontSize: 11, margin: '2px 0 0' }}>{formatDate(date)}</p>
          </div>
          <div
            style={{
              background: color + '22',
              border: `1px solid ${color}55`,
              borderRadius: 6,
              padding: '3px 10px',
              fontSize: 11,
              color: colorLight,
              fontWeight: 600,
            }}
          >
            Daily Report
          </div>
        </div>

        {/* Tower name */}
        <p
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: colorLight,
            margin: '18px 0 0',
            letterSpacing: '-0.02em',
          }}
        >
          {tower.tower} Tower
        </p>
      </div>

      {/* Big number */}
      <div style={{ padding: '12px 24px 16px', borderBottom: '1px solid #1E293B' }}>
        <p style={{ fontSize: 52, fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1, letterSpacing: '-0.03em' }}>
          {formatLitresFull(displayToday)}
        </p>
        <p style={{ color: '#64748B', fontSize: 13, margin: '4px 0 0' }}>Today&apos;s consumption</p>
        {diffPct != null && (
          <div
            style={{
              display: 'inline-block',
              marginTop: 8,
              background: diffPct >= 15 ? '#450A0A' : '#0f2a1a',
              border: `1px solid ${diffPct >= 15 ? '#991b1b' : '#166534'}`,
              borderRadius: 6,
              padding: '3px 10px',
              fontSize: 12,
              color: diffPct >= 15 ? '#FCA5A5' : '#86EFAC',
              fontWeight: 600,
            }}
          >
            {diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}% vs 7-day avg
            {diffPct >= 15 && '  ⚠'}
          </div>
        )}
      </div>

      {/* Historical comparison */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1E293B' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'Yesterday', value: displayYesterday },
            { label: '2 Days Ago', value: displayDayBefore },
            { label: '7-Day Avg', value: tower.seven_day_avg },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: '#1E293B',
                borderRadius: 8,
                padding: '10px 8px',
                textAlign: 'center',
              }}
            >
              <p style={{ color: '#64748B', fontSize: 10, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
              </p>
              <p style={{ color: '#E2E8F0', fontSize: 15, fontWeight: 700, margin: 0 }}>
                {value != null ? `${(value / 1000).toFixed(1)}k L` : '—'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div style={{ padding: '16px 24px' }}>
        <p
          style={{
            color: colorLight,
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '0 0 10px',
          }}
        >
          Water Conservation Tips
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TIPS.map((tip, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: color, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>•</span>
              <p style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.5, margin: 0 }}>{tip}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          background: '#1E293B',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <p style={{ color: '#475569', fontSize: 10, margin: 0 }}>Trinity World Residential Community</p>
        <p style={{ color: '#64748B', fontSize: 11, margin: 0, fontWeight: 600 }}>{phone}</p>
      </div>
    </div>
  );
}
