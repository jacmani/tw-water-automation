import type { TowerDashboardData } from '@/types';
import { TOWER_COLORS, TOWER_COLORS_LIGHT, formatLitresFull, formatMediumDate, percentageDiff } from '@/lib/utils';

const ALERT_TIPS = [
  'Check all taps and fixtures in the tower for running water.',
  'Reduce shower duration — every 2 minutes saved = 20 L saved.',
  'Alert the GC Chair immediately for an investigation.',
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

export default function TemplateC({ tower, date, animProgress = 1 }: Props) {
  const p = Math.max(0, Math.min(1, animProgress));
  const color = TOWER_COLORS[tower.tower];
  const colorLight = TOWER_COLORS_LIGHT[tower.tower];

  const overage =
    tower.total_today != null && tower.seven_day_avg != null && tower.seven_day_avg > 0
      ? percentageDiff(tower.total_today, tower.seven_day_avg)
      : null;

  // Count-up for the big number
  const animatedToday =
    tower.total_today != null ? Math.floor(tower.total_today * p) : null;

  // Alert icon pulses: 2 beats during animation, full size at end
  const iconScale = p >= 0.95 ? 1 : 1 + 0.3 * Math.abs(Math.sin(p * Math.PI * 2.5));
  // Tower color flash effect: oscillates during early animation
  const flashOpacity = p >= 0.7 ? 1 : 0.5 + 0.5 * Math.sin(p * Math.PI * 6);

  // Ken Burns: background zooms in slowly throughout
  const bgScale = 1.0 + 0.06 * p;

  return (
    <div
      style={{
        width: 400,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        background: '#0A0A0A',
      }}
    >
      {/* Background photo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/branding/tw-4.jpg"
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
          background: 'rgba(10, 10, 10, 0.84)',
          pointerEvents: 'none',
        }}
      />
      {/* Color flash overlay — pulsing tower color */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: color,
          opacity: 0.04 * flashOpacity,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
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
              transform: `scale(${iconScale})`,
              display: 'inline-block',
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
              textShadow: '0 2px 12px rgba(0,0,0,0.6)',
            }}
          >
            {tower.tower} Tower
          </p>
          <p style={{ color: '#6B7280', fontSize: 12, margin: '4px 0 0' }}>{formatMediumDate(date)}</p>
        </div>

        {/* Big number */}
        <div
          style={{
            margin: '0 24px',
            background: 'rgba(26, 0, 0, 0.80)',
            border: '1px solid #7F1D1D',
            borderRadius: 12,
            padding: '20px 0',
            textAlign: 'center',
            backdropFilter: 'blur(4px)',
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
              textShadow: '0 0 24px rgba(220,38,38,0.4)',
            }}
          >
            {formatLitresFull(animatedToday)}
          </p>
          <p style={{ color: '#9CA3AF', fontSize: 13, margin: '6px 0 0' }}>
            consumed on {formatMediumDate(date)}
          </p>
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
                opacity: p > 0.5 ? 1 : 0,
              }}
            >
              +{overage.toFixed(1)}% above normal
            </div>
          )}
        </div>

        {/* Comparison */}
        <div style={{ padding: '16px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'rgba(17, 24, 39, 0.80)', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
              <p style={{ color: '#6B7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
                Yesterday
              </p>
              <p style={{ color: '#E5E7EB', fontSize: 16, fontWeight: 700, margin: 0 }}>
                {formatLitresFull(tower.total_yesterday)}
              </p>
            </div>
            <div style={{ background: 'rgba(17, 24, 39, 0.80)', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
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
            padding: '14px 24px',
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
        </div>

        {/* WhatsApp + Call CTA */}
        <div
          style={{
            background: 'rgba(10, 10, 10, 0.95)',
            borderTop: '2px solid rgba(220, 38, 38, 0.50)',
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
            <span style={{ color: '#6B7280', fontSize: 10, letterSpacing: '0.04em' }}>Report a Leak</span>
          </div>

          <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.10)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d={PHONE_PATH} fill="#F87171" />
              </svg>
              <span style={{ color: '#F87171', fontSize: 13, fontWeight: 700 }}>9072624550</span>
            </div>
            <span style={{ color: '#6B7280', fontSize: 10, letterSpacing: '0.04em' }}>Call Maintenance</span>
          </div>
        </div>
      </div>
    </div>
  );
}
