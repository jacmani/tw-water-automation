import type { TowerDashboardData } from '@/types';
import { TOWER_COLORS, TOWER_COLORS_LIGHT, formatLitresFull, formatDate, percentageDiff } from '@/lib/utils';

const ALERT_TIPS = [
  'Check all taps and fixtures in the tower for running water.',
  'Reduce shower duration — every 2 minutes saved = 20 L saved.',
  'Alert the GC Chair immediately for an investigation.',
];

interface Props {
  tower: TowerDashboardData;
  date: string;
}

export default function TemplateC({ tower, date }: Props) {
  const color = TOWER_COLORS[tower.tower];
  const colorLight = TOWER_COLORS_LIGHT[tower.tower];
  const overage =
    tower.total_today != null && tower.seven_day_avg != null && tower.seven_day_avg > 0
      ? percentageDiff(tower.total_today, tower.seven_day_avg)
      : null;

  return (
    <div
      style={{
        width: 400,
        background: '#0A0A0A',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Alert stripe */}
      <div
        style={{
          background: 'repeating-linear-gradient(45deg, #DC2626 0px, #DC2626 10px, #B91C1C 10px, #B91C1C 20px)',
          height: 8,
        }}
      />

      {/* Header */}
      <div style={{ padding: '24px 24px 16px', textAlign: 'center' }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: '#DC2626',
            textTransform: 'uppercase',
            margin: '0 0 8px',
          }}
        >
          ⚠ Water Consumption Alert
        </p>
        <p
          style={{
            fontSize: 36,
            fontWeight: 900,
            color: colorLight,
            margin: 0,
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
          }}
        >
          {tower.tower} Tower
        </p>
        <p style={{ color: '#6B7280', fontSize: 12, margin: '4px 0 0' }}>{formatDate(date)}</p>
      </div>

      {/* Big number */}
      <div
        style={{
          margin: '0 24px',
          background: '#1A0000',
          border: '1px solid #7F1D1D',
          borderRadius: 12,
          padding: '20px 0',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: '#DC2626',
            margin: 0,
            lineHeight: 1,
            letterSpacing: '-0.03em',
          }}
        >
          {formatLitresFull(tower.total_today)}
        </p>
        <p style={{ color: '#9CA3AF', fontSize: 13, margin: '6px 0 0' }}>consumed today</p>
        {overage != null && (
          <div
            style={{
              display: 'inline-block',
              marginTop: 10,
              background: '#7F1D1D',
              borderRadius: 20,
              padding: '5px 16px',
              fontSize: 15,
              fontWeight: 800,
              color: '#FCA5A5',
            }}
          >
            +{overage.toFixed(1)}% above normal
          </div>
        )}
      </div>

      {/* Comparison */}
      <div style={{ padding: '16px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div
            style={{
              background: '#111827',
              borderRadius: 8,
              padding: '12px',
              textAlign: 'center',
            }}
          >
            <p style={{ color: '#6B7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
              Yesterday
            </p>
            <p style={{ color: '#E5E7EB', fontSize: 16, fontWeight: 700, margin: 0 }}>
              {formatLitresFull(tower.total_yesterday)}
            </p>
          </div>
          <div
            style={{
              background: '#111827',
              borderRadius: 8,
              padding: '12px',
              textAlign: 'center',
            }}
          >
            <p style={{ color: '#6B7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
              7-Day Avg
            </p>
            <p style={{ color: '#E5E7EB', fontSize: 16, fontWeight: 700, margin: 0 }}>
              {formatLitresFull(tower.seven_day_avg)}
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#1F2937', margin: '0 24px' }} />

      {/* Action tips */}
      <div style={{ padding: '16px 24px' }}>
        <p
          style={{
            color: '#DC2626',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            margin: '0 0 12px',
          }}
        >
          Immediate Action Required
        </p>
        {ALERT_TIPS.map((tip, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: i < ALERT_TIPS.length - 1 ? 10 : 0,
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                background: '#DC2626',
                color: '#fff',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <p style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 1.5, margin: 0 }}>{tip}</p>
          </div>
        ))}
      </div>

      {/* Tagline */}
      <div
        style={{
          background: '#DC2626',
          padding: '16px 24px',
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        <p
          style={{
            color: '#fff',
            fontSize: 15,
            fontWeight: 900,
            letterSpacing: '0.02em',
            margin: 0,
            textTransform: 'uppercase',
          }}
        >
          Stay Alert. Stay in Control.
        </p>
        <p style={{ color: '#FCA5A5', fontSize: 10, margin: '4px 0 0' }}>
          Trinity World Residential Community
        </p>
      </div>
    </div>
  );
}
