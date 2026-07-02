import type { PosterTowerData } from '@/lib/towerData';
import { TOWER_COLORS } from '@/lib/utils';
import { formatMediumDate } from '@/lib/utils';

const FONT_PLAYFAIR = "var(--font-playfair, 'Georgia', serif)";
const FONT_DM_SANS = "var(--font-dm-sans, system-ui, -apple-system, sans-serif)";

// TW logo mark — concentric water-drop rings in tower purple
function LogoMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke="#7C3AED" strokeWidth="2" fill="none" />
      <circle cx="16" cy="16" r="9"  stroke="#7C3AED" strokeWidth="2" fill="none" opacity="0.5" />
      <circle cx="16" cy="16" r="4"  fill="#7C3AED" />
    </svg>
  );
}

function fmtKL(v: number | null): string {
  if (v == null) return '—';
  return `${(v / 1000).toFixed(1)} kL`;
}

function DeltaBadge({ today, yesterday }: { today: number | null; yesterday: number | null }) {
  if (today == null || yesterday == null || yesterday === 0) {
    return (
      <span style={{
        fontSize: 11,
        color: '#94A3B8',
        fontFamily: FONT_DM_SANS,
      }}>
        No prior data
      </span>
    );
  }
  const pct = ((today - yesterday) / yesterday) * 100;
  const up = pct >= 0;
  const color = up ? '#DC2626' : '#059669'; // red = more consumption, green = less
  const arrow = up ? '▲' : '▼';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 12,
      fontWeight: 700,
      color,
      fontFamily: FONT_DM_SANS,
    }}>
      <span style={{ fontSize: 10 }}>{arrow}</span>
      {Math.abs(pct).toFixed(1)}% vs yesterday
    </span>
  );
}

function AnomalyBadge() {
  return (
    <span style={{
      display: 'inline-block',
      background: '#FEF2F2',
      border: '1px solid #FCA5A5',
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      color: '#DC2626',
      fontFamily: FONT_DM_SANS,
      letterSpacing: '0.04em',
    }}>
      HIGH
    </span>
  );
}

interface TowerCardProps {
  data: PosterTowerData;
}

function TowerCard({ data }: TowerCardProps) {
  const color = TOWER_COLORS[data.tower];
  return (
    <div style={{
      background: '#FFFFFF',
      border: `1.5px solid #E2E8F0`,
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Tower colour bar */}
      <div style={{ height: 4, background: color }} />

      <div style={{ padding: '12px 14px 14px' }}>
        {/* Tower name + anomaly badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{
            fontSize: 15,
            fontWeight: 700,
            color: color,
            fontFamily: FONT_PLAYFAIR,
            letterSpacing: '-0.01em',
          }}>
            {data.tower}
          </span>
          {data.isAnomaly && <AnomalyBadge />}
        </div>

        {/* Tower total for the date shown in the poster header — labelled "Total" rather
            than "Today" since this poster is typically shared the morning AFTER the date
            shown (technician uploads each morning a sheet covering the previous day). */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: '#64748B', fontFamily: FONT_DM_SANS, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Total
          </div>
          <div style={{
            fontSize: 26,
            fontWeight: 900,
            color: '#0F172A',
            fontFamily: FONT_DM_SANS,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}>
            {fmtKL(data.total_today)}
          </div>
        </div>

        {/* Delta */}
        <div style={{ minHeight: 20 }}>
          <DeltaBadge today={data.total_today} yesterday={data.total_yesterday} />
        </div>
      </div>
    </div>
  );
}

export interface TemplateOverallProps {
  date: string;
  towers: PosterTowerData[];
  communityTotal: number | null;
  communityYesterday: number | null;
}

export default function TemplateOverall({ date, towers, communityTotal, communityYesterday }: TemplateOverallProps) {
  const communityDeltaPct =
    communityTotal != null && communityYesterday != null && communityYesterday > 0
      ? ((communityTotal - communityYesterday) / communityYesterday) * 100
      : null;
  const communityUp = communityDeltaPct != null && communityDeltaPct >= 0;

  // Order: Venus, Jupiter, Neptune, Mercury (matches brief)
  const ORDER: PosterTowerData['tower'][] = ['Venus', 'Jupiter', 'Neptune', 'Mercury'];
  const orderedTowers = ORDER.map((name) => towers.find((t) => t.tower === name)!).filter(Boolean);

  return (
    <div style={{
      width: 420,
      background: '#F8FAFC',
      borderRadius: 14,
      overflow: 'hidden',
      fontFamily: FONT_DM_SANS,
      border: '1px solid #E2E8F0',
    }}>
      {/* Header */}
      <div style={{
        background: '#FFFFFF',
        borderBottom: '2px solid #7C3AED',
        padding: '20px 22px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <LogoMark />
          <div>
            <div style={{
              fontSize: 10,
              color: '#7C3AED',
              fontFamily: FONT_DM_SANS,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.10em',
            }}>
              Trinity World Apartments
            </div>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              color: '#0F172A',
              fontFamily: FONT_PLAYFAIR,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}>
              Daily Water Consumption
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 13,
          color: '#64748B',
          fontFamily: FONT_DM_SANS,
          fontWeight: 500,
        }}>
          {formatMediumDate(date)}
        </div>
      </div>

      {/* 2×2 tower grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        padding: '14px 14px 10px',
      }}>
        {orderedTowers.map((t) => (
          <TowerCard key={t.tower} data={t} />
        ))}
      </div>

      {/* Community total summary bar */}
      <div style={{
        margin: '0 14px 14px',
        background: '#0F172A',
        borderRadius: 10,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 10,
            color: '#94A3B8',
            fontFamily: FONT_DM_SANS,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 3,
          }}>
            Community Total
          </div>
          <div style={{
            fontSize: 28,
            fontWeight: 900,
            color: '#FFFFFF',
            fontFamily: FONT_DM_SANS,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}>
            {fmtKL(communityTotal)}
          </div>
        </div>

        {communityDeltaPct != null && (
          <div style={{
            background: communityUp ? 'rgba(220,38,38,0.15)' : 'rgba(5,150,105,0.15)',
            border: `1px solid ${communityUp ? '#FCA5A5' : '#6EE7B7'}`,
            borderRadius: 8,
            padding: '8px 14px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              color: communityUp ? '#FCA5A5' : '#6EE7B7',
              fontFamily: FONT_DM_SANS,
              lineHeight: 1,
            }}>
              {communityUp ? '▲' : '▼'} {Math.abs(communityDeltaPct).toFixed(1)}%
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: FONT_DM_SANS, marginTop: 3 }}>
              vs yesterday
            </div>
          </div>
        )}

        {communityDeltaPct == null && communityTotal != null && (
          <div style={{ fontSize: 11, color: '#64748B', fontFamily: FONT_DM_SANS }}>
            No prior data
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        background: '#F1F5F9',
        borderTop: '1px solid #E2E8F0',
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: FONT_DM_SANS }}>
          Trinity World Residential Community
        </span>
        <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: FONT_DM_SANS }}>
          Water Automation System
        </span>
      </div>
    </div>
  );
}
