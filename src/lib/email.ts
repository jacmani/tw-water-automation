import { Resend } from 'resend';
import { TOWER_COLORS } from '@/lib/utils';
import type { TowerName } from '@/types';

// ─── Client ─────────────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!);
  return _resend;
}

// ─── Sandbox / production switch ─────────────────────────────────────────────
//
// RESEND_SANDBOX=false  → use verified domain + real recipients
// anything else (default) → sandbox mode: all emails → jacmani@gmail.com
//
const IS_SANDBOX = process.env.RESEND_SANDBOX !== 'false';
const SANDBOX_TO = 'jacmani@gmail.com';
const FROM_SANDBOX = 'onboarding@resend.dev';
const FROM_PROD = `TW Water Alerts <alerts@${process.env.RESEND_DOMAIN ?? 'tworld.in'}>`;

export const FROM = IS_SANDBOX ? FROM_SANDBOX : FROM_PROD;

export function resolveRecipients(prodList: string[]): string[] {
  return IS_SANDBOX ? [SANDBOX_TO] : prodList.filter(Boolean);
}

// ─── Supabase helpers (imported lazily to avoid circular deps) ────────────────

type Supabase = ReturnType<typeof import('@/lib/supabase').createServerClient>;

export async function getAlertRecipients(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase
    .from('committee_members')
    .select('email')
    .eq('active', true)
    .in('role', ['President', 'Secretary', 'Vice President', 'GC Chair'])
    .not('email', 'is', null);
  return resolveRecipients((data ?? []).map((m) => m.email as string));
}

export async function getAllActiveRecipients(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase
    .from('committee_members')
    .select('email')
    .eq('active', true)
    .not('email', 'is', null);
  return resolveRecipients((data ?? []).map((m) => m.email as string));
}

// ─── log ─────────────────────────────────────────────────────────────────────

async function logAlert(
  supabase: Supabase,
  entry: {
    alert_type: string;
    sheet_date?: string | null;
    tower?: string | null;
    recipients: string[];
    subject: string;
    status: string;
    details?: Record<string, unknown>;
  },
) {
  await supabase.from('alert_log').insert({
    alert_type: entry.alert_type,
    sheet_date: entry.sheet_date ?? null,
    tower: entry.tower ?? null,
    recipients: entry.recipients,
    subject: entry.subject,
    status: entry.status,
    details: entry.details ?? {},
  });
}

// ─── Send helper ─────────────────────────────────────────────────────────────

async function send(
  supabase: Supabase,
  {
    to,
    subject,
    html,
    alertType,
    sheetDate,
    tower,
  }: {
    to: string[];
    subject: string;
    html: string;
    alertType: string;
    sheetDate?: string;
    tower?: string;
  },
) {
  const resend = getResend();
  let status = 'sent';
  let details: Record<string, unknown> = {};

  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      status = 'error';
      details = { error };
    } else {
      details = { resend_id: data?.id, sandbox: IS_SANDBOX };
    }
  } catch (err) {
    status = 'error';
    details = { error: String(err) };
  }

  await logAlert(supabase, { alert_type: alertType, sheet_date: sheetDate, tower, recipients: to, subject, status, details });
  return status;
}

// ─── Spike Alert ─────────────────────────────────────────────────────────────

export interface SpikePayload {
  tower: TowerName;
  sheetDate: string;
  currentLitres: number;
  sevenDayAvg: number;
  overagePct: number;
}

export async function sendSpikeAlert(supabase: Supabase, payload: SpikePayload) {
  const { tower, sheetDate, currentLitres, sevenDayAvg, overagePct } = payload;
  const to = await getAlertRecipients(supabase);
  if (!to.length) return;

  const color = TOWER_COLORS[tower];
  const subject = `⚠ Water Alert: ${tower} Tower — +${overagePct.toFixed(0)}% above normal (${sheetDate})`;
  const html = spikeAlertHtml({ tower, sheetDate, currentLitres, sevenDayAvg, overagePct, color });

  await send(supabase, { to, subject, html, alertType: 'spike', sheetDate, tower });
}

// ─── Weekly Report ───────────────────────────────────────────────────────────

export interface WeeklyReportPayload {
  weekStart: string;
  weekEnd: string;
  towerTotals: { tower: string; total: number }[];
  communityTotal: number;
  prevWeekTotal: number | null;
  spikesThisWeek: { tower: string; date: string; pct: number }[];
}

export async function sendWeeklyReport(supabase: Supabase, payload: WeeklyReportPayload) {
  const to = await getAllActiveRecipients(supabase);
  if (!to.length) return;

  const subject = `Trinity World Water Consumption — Weekly Report (${payload.weekStart} → ${payload.weekEnd})`;
  const html = weeklyReportHtml(payload);

  await send(supabase, { to, subject, html, alertType: 'weekly', sheetDate: payload.weekEnd });
}

// ─── Monthly Report ──────────────────────────────────────────────────────────

export interface MonthlyReportPayload {
  month: string; // e.g. "May 2026"
  towerTotals: { tower: string; total: number }[];
  communityTotal: number;
  prevMonthTotal: number | null;
  spikeDays: number;
}

export async function sendMonthlyReport(supabase: Supabase, payload: MonthlyReportPayload) {
  const to = await getAllActiveRecipients(supabase);
  if (!to.length) return;

  const subject = `Trinity World Water Consumption — Monthly Report: ${payload.month}`;
  const html = monthlyReportHtml(payload);

  await send(supabase, { to, subject, html, alertType: 'monthly' });
}

// ─── HTML Templates ──────────────────────────────────────────────────────────

// Colour/style constants extracted into one object (audit §5 — email.ts previously
// had 20+ hardcoded hex values scattered through the template functions below).
const EMAIL_TOKENS = {
  bg: '#0F172A',
  bgAlt: '#1E293B',
  bgFooter: '#0A0F1E',
  border: '#1E293B',
  borderStrong: '#334155',
  text: '#fff',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  textFooter: '#475569',
  h2Color: '#E2E8F0',
  bodyText: '#CBD5E1',
  red: '#DC2626',
  redSoft: '#FCA5A5',
  redBg: '#7F1D1D',
  green: '#86EFAC',
  greenBg: 'rgba(22,101,52,0.25)',
  greenBorder: '#166534',
  greenText: '#4ADE80',
  waGreen: '#25D366',
  blueLink: '#60A5FA',
  accentHeight: '8px', // audit — was 5px, read as a hairline artifact rather than a deliberate accent
} as const;

const BASE_CSS = `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:0;background:${EMAIL_TOKENS.bg};color:${EMAIL_TOKENS.text};`;
const CONTAINER = `max-width:600px;margin:0 auto;background:${EMAIL_TOKENS.bg};`;
const CELL = `padding:24px 32px;`;
const MUTED = `color:${EMAIL_TOKENS.textMuted};font-size:13px;`;
const H2 = `color:${EMAIL_TOKENS.h2Color};font-size:22px;font-weight:800;margin:0 0 4px;letter-spacing:-0.5px;`;
const LABEL = `color:${EMAIL_TOKENS.textFaint};font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;`;
const VALUE_LG = `color:${EMAIL_TOKENS.text};font-size:28px;font-weight:900;margin:0;letter-spacing:-1px;`;
const DASH_URL = 'https://tw-water-automation.vercel.app';

function fmt(litres: number): string {
  return `${litres.toLocaleString('en-IN')} L`;
}

function pctChange(current: number, prev: number | null): string {
  if (prev == null || prev === 0) return '';
  const pct = ((current - prev) / prev) * 100;
  const sign = pct > 0 ? '+' : '';
  const color = pct > 5 ? '#FCA5A5' : pct < -5 ? '#86EFAC' : '#94A3B8';
  return `<span style="color:${color};font-size:14px;font-weight:600;">&nbsp;${sign}${pct.toFixed(1)}% vs prior period</span>`;
}

function towerBadges(towerTotals: { tower: string; total: number }[]): string {
  const sorted = [...towerTotals].sort((a, b) => b.total - a.total);
  return sorted
    .map((t) => {
      const color = TOWER_COLORS[t.tower as TowerName] ?? '#64748B';
      return `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #1E293B;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="display:flex;align-items:center;gap:8px;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>
                  <span style="color:#CBD5E1;font-size:14px;font-weight:600;">${t.tower}</span>
                </td>
                <td align="right" style="color:#E2E8F0;font-size:14px;font-weight:700;">${fmt(t.total)}</td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join('');
}

function spikeBadge(tower: string, pct: number): string {
  const color = TOWER_COLORS[tower as TowerName] ?? '#DC2626';
  return `<tr><td style="padding:4px 0;"><span style="display:inline-block;background:rgba(220,38,38,0.15);border:1px solid #991b1b;border-radius:6px;padding:3px 10px;font-size:12px;color:#FCA5A5;font-weight:600;">${tower}: +${pct.toFixed(0)}% above avg</span></td></tr>`;
}

// waUrl: full https://wa.me/?text=... href (already encoded). waPrimary: spike layout (WA full-width, dashboard text link).
function ctaSection(waUrl?: string, waPrimary = false): string {
  const BORDER = 'border-top:1px solid #1E293B;';
  if (!waUrl) {
    return `
      <tr><td style="padding:16px 32px 20px;text-align:center;${BORDER}">
        <a href="${DASH_URL}" style="display:inline-block;background:#1E293B;border:1.5px solid #334155;color:#94A3B8;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;font-family:system-ui,sans-serif;">View Dashboard →</a>
      </td></tr>`;
  }
  const waBtn = `<a href="${waUrl}" style="display:block;background:#25D366;color:#fff;font-size:${waPrimary ? '15' : '13'}px;font-weight:700;padding:${waPrimary ? '14px' : '11px 16px'};border-radius:8px;text-decoration:none;text-align:center;font-family:system-ui,sans-serif;">📱 Share on WhatsApp</a>`;
  if (waPrimary) {
    return `
      <tr><td style="padding:16px 32px 8px;${BORDER}">${waBtn}</td></tr>
      <tr><td style="padding:4px 32px 20px;text-align:center;">
        <a href="${DASH_URL}" style="color:#60A5FA;font-size:13px;font-weight:600;text-decoration:underline;font-family:system-ui,sans-serif;">View Dashboard →</a>
      </td></tr>`;
  }
  const dashBtn = `<a href="${DASH_URL}" style="display:block;background:#1E293B;border:1.5px solid #334155;color:#94A3B8;font-size:13px;font-weight:600;padding:11px 16px;border-radius:8px;text-decoration:none;text-align:center;font-family:system-ui,sans-serif;">View Dashboard →</a>`;
  return `
    <tr><td style="padding:16px 32px 20px;${BORDER}">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="50%" style="padding-right:6px;">${dashBtn}</td>
        <td width="50%" style="padding-left:6px;">${waBtn}</td>
      </tr></table>
    </td></tr>`;
}

function emailShell(accentColor: string, previewText: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>${previewText}</title>
  <style>
    /* Emails are dark-styled by design (card + accent bar). In a light-mode email
       client (e.g. Gmail desktop), the OUTER page background is normally white,
       which reads as jarring next to a hardcoded-dark card. This lightens just the
       outer page background in light-mode clients while leaving the card itself —
       and all its inner text colours — untouched (audit I3). */
    @media (prefers-color-scheme: light) {
      .email-outer-bg { background:#E2E8F0 !important; }
    }
  </style>
</head>
<body style="${BASE_CSS}">
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <table width="100%" cellpadding="0" cellspacing="0" class="email-outer-bg" style="${BASE_CSS}">
    <tr><td>
      <table width="600" align="center" cellpadding="0" cellspacing="0" style="${CONTAINER}border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
        <!-- accent bar -->
        <tr><td style="background:${accentColor};height:${EMAIL_TOKENS.accentHeight};font-size:0;">&nbsp;</td></tr>
        <!-- TW identity header -->
        <tr><td style="padding:16px 32px;border-bottom:1px solid #1E293B;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px;vertical-align:middle;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td width="40" height="40" style="background:#7C3AED;border-radius:20px;text-align:center;vertical-align:middle;padding:9px 9px 9px 10px;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0C19 10 12 2 12 2z"/></svg>
                </td>
              </tr></table>
            </td>
            <td style="vertical-align:middle;">
              <div style="color:#fff;font-size:14px;font-weight:700;font-family:system-ui,sans-serif;line-height:1.2;margin:0;">Trinity World</div>
              <div style="color:#64748B;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;font-family:system-ui,sans-serif;margin:2px 0 0;">Water Management System</div>
            </td>
          </tr></table>
        </td></tr>
        ${body}
        <!-- footer -->
        <tr><td style="background:#0A0F1E;padding:16px 32px;text-align:center;">
          <p style="${MUTED}margin:0;">Trinity World Residential Community · Automated Water Report</p>
          <p style="color:#475569;font-size:11px;margin:4px 0 0;">
            ${IS_SANDBOX ? '⚠ Sandbox mode — all emails routed to ' + SANDBOX_TO : 'To unsubscribe, contact the committee secretary.'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function spikeAlertHtml({ tower, sheetDate, currentLitres, sevenDayAvg, overagePct, color }: SpikePayload & { color: string }): string {
  // "on {sheetDate}", not "today" — sheetDate is the reading date printed on the
  // sheet, which is normally the day BEFORE this alert is sent (technician uploads
  // each morning a sheet covering the previous day's readings).
  const spikeWaUrl = `https://wa.me/?text=${encodeURIComponent(`⚠ Water Alert — ${tower} Tower: ${fmt(currentLitres)} on ${sheetDate} (+${overagePct.toFixed(0)}% above 7-day avg). Please investigate. Full report: ${DASH_URL}`)}`;
  const overageLitres = fmt(currentLitres - sevenDayAvg);
  // Audit: "too much red simultaneously" — header used to have a red-tinted
  // background PLUS a red label PLUS a red H2. Now only the small uppercase label
  // pill signals urgency; the header background matches every other cell (neutral)
  // and H2 stays light/white. The red accent bar + red stat pill further down are
  // enough — the reader shouldn't need a wall of red to know this is urgent.
  const body = `
    <!-- header -->
    <tr><td style="${CELL}border-bottom:1px solid ${EMAIL_TOKENS.border};">
      <span style="display:inline-block;background:${EMAIL_TOKENS.redBg};border-radius:20px;padding:4px 12px;color:${EMAIL_TOKENS.redSoft};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">⚠ Water Consumption Alert</span>
      <h2 style="${H2}margin-top:8px;">${tower} Tower — Spike Detected</h2>
      <p style="${MUTED}margin:4px 0 0;">${sheetDate}</p>
    </td></tr>
    <!-- big number -->
    <tr><td style="${CELL}text-align:center;border-bottom:1px solid #1E293B;">
      <p style="${LABEL}">Consumption on ${sheetDate}</p>
      <p style="${VALUE_LG}color:#DC2626;">${fmt(currentLitres)}</p>
      <p style="display:inline-block;margin:10px 0 0;background:#7F1D1D;border-radius:20px;padding:5px 16px;font-size:15px;font-weight:800;color:#FCA5A5;">
        +${overagePct.toFixed(1)}% above 7-day average
      </p>
    </td></tr>
    <!-- comparison -->
    <tr><td style="${CELL}">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="padding:0 8px 0 0;">
            <div style="background:#1E293B;border-radius:8px;padding:14px;text-align:center;">
              <p style="${LABEL}">7-Day Average</p>
              <p style="color:#E2E8F0;font-size:18px;font-weight:700;margin:0;">${fmt(sevenDayAvg)}</p>
            </div>
          </td>
          <td width="50%" style="padding:0 0 0 8px;">
            <div style="background:#1E293B;border-radius:8px;padding:14px;text-align:center;">
              <p style="${LABEL}">Overage</p>
              <p style="color:#FCA5A5;font-size:18px;font-weight:700;margin:0;">+${fmt(currentLitres - sevenDayAvg)}</p>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
    <!-- cta -->
    <tr><td style="${CELL}background:${EMAIL_TOKENS.bgAlt};border-top:1px solid ${EMAIL_TOKENS.borderStrong};border-left:3px solid ${color};">
      <p style="${MUTED}margin:0 0 8px;font-weight:600;">What to do now</p>
      <p style="color:${EMAIL_TOKENS.textMuted};font-size:13px;margin:0 0 4px;">• Check all taps and fixtures in ${tower} Tower for running water</p>
      <p style="color:${EMAIL_TOKENS.textMuted};font-size:13px;margin:0 0 4px;">• Alert the ${tower} GC Chair to investigate</p>
      <p style="color:${EMAIL_TOKENS.textMuted};font-size:13px;margin:0;">• WhatsApp / Call Maintenance: <a href="tel:9072624550" style="color:${EMAIL_TOKENS.blueLink};font-weight:700;text-decoration:none;">9072624550</a></p>
    </td></tr>
    ${ctaSection(spikeWaUrl, true)}`;
  // Preheader is now specific to this incident (audit — was just repeating the
  // subject line), so the inbox preview line itself is useful information.
  return emailShell(color, `${tower} used ${overageLitres} more than usual on ${sheetDate} — check for leaks or open taps`, body);
}

function weeklyReportHtml(p: WeeklyReportPayload): string {
  const weeklyWaUrl = `https://wa.me/?text=${encodeURIComponent(`📊 TW Weekly Water Report (${p.weekStart} → ${p.weekEnd}): ${fmt(p.communityTotal)} community total. Full report: ${DASH_URL}`)}`;
  const spikesHtml = p.spikesThisWeek.length
    ? `<tr><td style="${CELL}border-top:1px solid #1E293B;">
        <p style="${LABEL}margin-bottom:8px;">Spike Alerts This Week</p>
        <table cellpadding="0" cellspacing="0">${p.spikesThisWeek.map((s) => spikeBadge(s.tower, s.pct)).join('')}</table>
       </td></tr>`
    : `<tr><td style="${CELL}border-top:1px solid ${EMAIL_TOKENS.border};">
        <span style="display:inline-block;background:${EMAIL_TOKENS.greenBg};border:1px solid ${EMAIL_TOKENS.greenBorder};border-radius:20px;padding:6px 14px;color:${EMAIL_TOKENS.greenText};font-size:13px;font-weight:700;">✓ Clean week — no spike alerts</span>
       </td></tr>`;

  const body = `
    <tr><td style="${CELL}border-bottom:1px solid #1E293B;">
      <p style="color:#94A3B8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 4px;">Trinity World Water Consumption</p>
      <h2 style="${H2}">Weekly Report</h2>
      <p style="${MUTED}margin:4px 0 0;">${p.weekStart} → ${p.weekEnd}</p>
    </td></tr>
    <tr><td style="${CELL}text-align:center;border-bottom:1px solid #1E293B;">
      <p style="${LABEL}">Community Total (7 days)</p>
      <p style="${VALUE_LG}">${fmt(p.communityTotal)}</p>
      <p style="margin:4px 0 0;font-size:13px;">${pctChange(p.communityTotal, p.prevWeekTotal)}</p>
    </td></tr>
    <tr><td style="${CELL}border-bottom:1px solid #1E293B;">
      <p style="${LABEL}margin-bottom:8px;">Per Tower Totals</p>
      <table width="100%" cellpadding="0" cellspacing="0">${towerBadges(p.towerTotals)}</table>
    </td></tr>
    ${spikesHtml}
    ${ctaSection(weeklyWaUrl)}`;
  const spikeNote = p.spikesThisWeek.length
    ? `${p.spikesThisWeek.length} spike alert${p.spikesThisWeek.length > 1 ? 's' : ''} this week`
    : 'a clean week, no spike alerts';
  return emailShell('#2563EB', `${fmt(p.communityTotal)} community total — ${spikeNote}`, body);
}

function monthlyReportHtml(p: MonthlyReportPayload): string {
  // Simple inline bar chart using divs (email-safe)
  const maxVal = Math.max(...p.towerTotals.map((t) => t.total), 1);
  const bars = p.towerTotals
    .sort((a, b) => b.total - a.total)
    .map((t) => {
      const pct = Math.round((t.total / maxVal) * 100);
      const color = TOWER_COLORS[t.tower as TowerName] ?? '#64748B';
      return `
        <tr>
          <td style="padding:5px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="80" style="color:#CBD5E1;font-size:13px;font-weight:600;">${t.tower}</td>
                <td>
                  <div style="background:#1E293B;border-radius:3px;overflow:hidden;height:18px;">
                    <div style="background:${color};height:18px;width:${pct}%;border-radius:3px;"></div>
                  </div>
                </td>
                <td width="90" align="right" style="color:#CBD5E1;font-size:12px;font-weight:600;padding-left:8px;">${fmt(t.total)}</td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join('');

  const body = `
    <tr><td style="${CELL}border-bottom:1px solid #1E293B;">
      <p style="color:#94A3B8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 4px;">Trinity World Water Consumption</p>
      <h2 style="${H2}">Monthly Report</h2>
      <p style="${MUTED}margin:4px 0 0;">${p.month}</p>
    </td></tr>
    <tr><td style="${CELL}border-bottom:1px solid ${EMAIL_TOKENS.border};">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <!-- Spike alert days used to be buried in tiny muted text at the bottom of
             the email; promoted here to a stat card alongside Community Total so it
             gets equal billing (audit — monthly report). -->
        <td width="58%" style="text-align:center;padding-right:8px;">
          <p style="${LABEL}">Total Community Consumption</p>
          <p style="${VALUE_LG}font-size:24px;">${fmt(p.communityTotal)}</p>
          <p style="margin:4px 0 0;font-size:12px;">${pctChange(p.communityTotal, p.prevMonthTotal)}</p>
        </td>
        <td width="42%" style="text-align:center;padding-left:8px;border-left:1px solid ${EMAIL_TOKENS.border};">
          <p style="${LABEL}">Spike Alert Days</p>
          <p style="margin:0;font-size:24px;font-weight:900;color:${p.spikeDays > 0 ? EMAIL_TOKENS.redSoft : EMAIL_TOKENS.greenText};">${p.spikeDays}</p>
          <p style="margin:4px 0 0;font-size:11px;color:${EMAIL_TOKENS.textFaint};">${p.spikeDays > 0 ? 'this month' : '✓ clean month'}</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="${CELL}">
      <p style="${LABEL}margin-bottom:12px;">Per Tower Totals — ${p.month}</p>
      <table width="100%" cellpadding="0" cellspacing="0">${bars}</table>
    </td></tr>
    ${ctaSection()}`;
  const spikeNote = p.spikeDays > 0 ? `${p.spikeDays} spike alert day${p.spikeDays > 1 ? 's' : ''}` : 'a clean month, no spike days';
  return emailShell('#7C3AED', `${fmt(p.communityTotal)} for ${p.month} — ${spikeNote}`, body);
}
