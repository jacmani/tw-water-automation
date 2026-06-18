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

const BASE_CSS = `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:0;background:#0F172A;color:#fff;`;
const CONTAINER = `max-width:600px;margin:0 auto;background:#0F172A;`;
const CELL = `padding:24px 32px;`;
const MUTED = `color:#94A3B8;font-size:13px;`;
const H2 = `color:#E2E8F0;font-size:22px;font-weight:800;margin:0 0 4px;letter-spacing:-0.5px;`;
const LABEL = `color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;`;
const VALUE_LG = `color:#fff;font-size:28px;font-weight:900;margin:0;letter-spacing:-1px;`;

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

function emailShell(accentColor: string, previewText: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${previewText}</title>
</head>
<body style="${BASE_CSS}">
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="${BASE_CSS}">
    <tr><td>
      <table width="600" align="center" cellpadding="0" cellspacing="0" style="${CONTAINER}border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
        <!-- accent bar -->
        <tr><td style="background:${accentColor};height:5px;font-size:0;">&nbsp;</td></tr>
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
  const body = `
    <!-- header -->
    <tr><td style="${CELL}background:rgba(127,29,29,0.30);border-bottom:1px solid #7F1D1D;">
      <p style="color:#DC2626;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 6px;">⚠ Water Consumption Alert</p>
      <h2 style="${H2}">${tower} Tower — Spike Detected</h2>
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
    <tr><td style="${CELL}background:#1E293B;border-top:1px solid #334155;">
      <p style="${MUTED}margin:0 0 8px;font-weight:600;">Recommended Actions</p>
      <p style="color:#94A3B8;font-size:13px;margin:0 0 4px;">• Check all taps and fixtures in ${tower} Tower for running water</p>
      <p style="color:#94A3B8;font-size:13px;margin:0 0 4px;">• Alert the ${tower} GC Chair to investigate</p>
      <p style="color:#94A3B8;font-size:13px;margin:0;">• WhatsApp / Call Maintenance: <strong style="color:#60A5FA;">9072624550</strong></p>
    </td></tr>`;
  return emailShell(color, `⚠ Water Alert: ${tower} Tower +${overagePct.toFixed(0)}%`, body);
}

function weeklyReportHtml(p: WeeklyReportPayload): string {
  const spikesHtml = p.spikesThisWeek.length
    ? `<tr><td style="${CELL}border-top:1px solid #1E293B;">
        <p style="${LABEL}margin-bottom:8px;">Spike Alerts This Week</p>
        <table cellpadding="0" cellspacing="0">${p.spikesThisWeek.map((s) => spikeBadge(s.tower, s.pct)).join('')}</table>
       </td></tr>`
    : `<tr><td style="${CELL}border-top:1px solid #1E293B;">
        <p style="${MUTED}margin:0;">✓ No spike alerts this week</p>
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
    ${spikesHtml}`;
  return emailShell('#2563EB', `Weekly Water Report: ${p.weekStart} → ${p.weekEnd}`, body);
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
    <tr><td style="${CELL}text-align:center;border-bottom:1px solid #1E293B;">
      <p style="${LABEL}">Total Community Consumption</p>
      <p style="${VALUE_LG}">${fmt(p.communityTotal)}</p>
      <p style="margin:4px 0 0;font-size:13px;">${pctChange(p.communityTotal, p.prevMonthTotal)}</p>
    </td></tr>
    <tr><td style="${CELL}border-bottom:1px solid #1E293B;">
      <p style="${LABEL}margin-bottom:12px;">Per Tower Totals — ${p.month}</p>
      <table width="100%" cellpadding="0" cellspacing="0">${bars}</table>
    </td></tr>
    <tr><td style="${CELL}">
      <p style="${LABEL}margin-bottom:6px;">Month Summary</p>
      <p style="${MUTED}margin:0;">Spike alert days this month: <strong style="color:#FCA5A5;">${p.spikeDays}</strong></p>
    </td></tr>`;
  return emailShell('#7C3AED', `Monthly Water Report: ${p.month}`, body);
}
