import type { TowerDashboardData } from '@/types';
import { TOWER_COLORS, TOWER_COLORS_LIGHT, formatLitresFull, formatMediumDate, percentageDiff } from '@/lib/utils';

const TIPS = [
  'Fix dripping taps — one drip wastes 20,000 L per year.',
  'Run washing machines and dishwashers on full loads only.',
  'Spot a leak? Report it to maintenance immediately.',
];

const WA_PATH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';

const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

interface Props {
  tower: TowerDashboardData;
  date: string;
  animProgress?: number; // 0–1; 1 = fully rendered (static/PNG mode)
}

export default function TemplateA({ tower, date, animProgress = 1 }: Props) {
  const p = Math.max(0, Math.min(1, animProgress));
  const color = TOWER_COLORS[tower.tower];
  const colorLight = TOWER_COLORS_LIGHT[tower.tower];

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

  // Count-up: display animated value
  const animatedToday =
    displayToday != null ? Math.floor(displayToday * p) : null;

  // Ken Burns: starts zoomed in, zooms out as animation progresses
  const bgScale = 1.08 - 0.08 * p;
  const bgY = -6 * (1 - p);

  return (
    <div
      style={{
        width: 400,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        background: '#0F172A',
      }}
    >
      {/* Background photo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/tw-3.jpg"
        alt=""
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${bgScale}) translateY(${bgY}px)`,
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
          background: 'rgba(15, 23, 42, 0.80)',
          pointerEvents: 'none',
        }}
      />

      {/* All content is relative so it sits above the overlay */}
      <div style={{ position: 'relative' }}>
        {/* Color accent bar */}
        <div style={{ background: color, height: 6 }} />

        {/* Header */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: '#94A3B8', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
                TRINITY WORLD WATER
              </p>
              <p style={{ color: '#CBD5E1', fontSize: 11, margin: '2px 0 0' }}>
                {formatMediumDate(date)}
              </p>
            </div>
            <div
              style={{
                background: color + '33',
                border: `1px solid ${color}66`,
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
              textShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            {tower.tower} Tower
          </p>
        </div>

        {/* Big number */}
        <div style={{ padding: '12px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: 52, fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1, letterSpacing: '-0.03em', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
            {formatLitresFull(animatedToday)}
          </p>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '4px 0 0', fontWeight: 500 }}>
            Yesterday&apos;s Consumption — {formatMediumDate(date)}
          </p>
          {diffPct != null && p > 0.6 && (
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
                opacity: Math.min(1, (p - 0.6) / 0.4),
              }}
            >
              {diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}% vs 7-day avg
              {diffPct >= 15 && '  ⚠'}
            </div>
          )}
        </div>

        {/* Historical comparison */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: 'Yesterday', value: displayYesterday },
              { label: '2 Days Ago', value: displayDayBefore },
              { label: '7-Day Avg', value: tower.seven_day_avg },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: 'rgba(30, 41, 59, 0.80)',
                  borderRadius: 8,
                  padding: '10px 8px',
                  textAlign: 'center',
                  backdropFilter: 'blur(4px)',
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

        {/* WhatsApp + Call CTA */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            borderTop: `2px solid ${color}55`,
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}
        >
          {/* WhatsApp */}
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

          {/* Call */}
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
