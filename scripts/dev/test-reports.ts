/**
 * Dev helper — sends a test weekly report and a test monthly report using
 * real Supabase data and the live Resend sandbox credentials.
 *
 * KEEP THIS FILE. It lives in scripts/dev/ intentionally for future use
 * whenever you need to verify the report email templates with real data
 * without waiting for the Monday/1st cron to fire.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json -r tsconfig-paths/register scripts/dev/test-reports.ts
 *
 * What it does:
 *   1. Weekly  — last 7 days of sheets (today − 6 → today), same aggregation
 *                as /api/cron/weekly-report. Logs alert_type='test-weekly'.
 *   2. Monthly — current calendar month (1st → today), same aggregation as
 *                /api/cron/monthly-report. Logs alert_type='test-monthly'.
 *
 * Both sends use the Resend sandbox (FROM=onboarding@resend.dev, TO=jacmani@gmail.com)
 * and write a row to alert_log so they appear on /alerts.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { FROM, resolveRecipients } from '@/lib/email';
import type { TowerName } from '@/types';

// ─── Supabase client (service role for full read access) ─────────────────────

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const resend = new Resend(process.env.RESEND_API_KEY!);

// ─── Formatting helpers ────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fmt(n: number): string {
  return `${n.toLocaleString('en-IN')} L`;
}

function fmtKL(n: number): string {
  return `${(n / 1000).toFixed(1)} kL`;
}

function pctLine(current: number, prev: number | null): string {
  if (prev == null || prev === 0) return '';
  const pct = ((current - prev) / prev) * 100;
  const sign = pct > 0 ? '+' : '';
  const color = pct > 5 ? '#FCA5A5' : pct < -5 ? '#86EFAC' : '#94A3B8';
  return `<span style="font-size:13px;font-weight:600;color:${color};">&nbsp;${sign}${pct.toFixed(1)}% vs prior period</span>`;
}

const TOWER_COLORS: Record<string, string> = {
  Venus: '#7C3AED',
  Mercury: '#2563EB',
  Neptune: '#059669',
  Jupiter: '#EA580C',
};

// ─── Shared email shell ────────────────────────────────────────────────────────

function shell(accentColor: string, previewText: string, body: string): string {
  const IS_SANDBOX = process.env.RESEND_SANDBOX !== 'false';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
</head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:0;background:#0F172A;color:#fff;">
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F172A;">
    <tr><td>
      <table width="600" align="center" cellpadding="0" cellspacing="0"
             style="max-width:600px;margin:24px auto;background:#0F172A;border-radius:12px;overflow:hidden;border:1px solid #1E293B;">
        <tr><td style="background:${accentColor};height:5px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="background:#1C1917;padding:8px 32px;border-bottom:1px solid #292524;">
          <p style="color:#FCD34D;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0;">
            ⚙ DEV TEST SEND — data is real, alert_type=test
          </p>
        </td></tr>
        ${body}
        <tr><td style="background:#0A0F1E;padding:16px 32px;text-align:center;border-top:1px solid #1E293B;">
          <p style="color:#94A3B8;font-size:13px;margin:0;">Trinity World Residential Community · Automated Water Report</p>
          <p style="color:#475569;font-size:11px;margin:4px 0 0;">
            ${IS_SANDBOX ? '⚠ Sandbox mode — all emails routed to jacmani@gmail.com' : 'Production send'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Tower rows HTML helper ────────────────────────────────────────────────────

function towerRowsHtml(towerTotals: { tower: string; total: number }[]): string {
  return [...towerTotals]
    .sort((a, b) => b.total - a.total)
    .map(t => {
      const color = TOWER_COLORS[t.tower] ?? '#64748B';
      return `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #1E293B;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle;"></span>
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

// ─── HTML builders ────────────────────────────────────────────────────────────

function weeklyHtml(p: {
  weekStart: string;
  weekEnd: string;
  towerTotals: { tower: string; total: number }[];
  communityTotal: number;
  prevWeekTotal: number | null;
  spikesThisWeek: { tower: string; date: string; pct: number }[];
}): string {
  const spikesHtml = p.spikesThisWeek.length
    ? `<tr><td style="padding:24px 32px;border-top:1px solid #1E293B;">
        <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Spike Alerts This Week</p>
        ${p.spikesThisWeek.map(s =>
          `<span style="display:inline-block;background:rgba(220,38,38,0.15);border:1px solid #991b1b;border-radius:6px;padding:3px 10px;font-size:12px;color:#FCA5A5;font-weight:600;margin:2px 4px 2px 0;">${s.tower}: +${s.pct.toFixed(0)}% above avg</span>`
        ).join('')}
       </td></tr>`
    : `<tr><td style="padding:16px 32px;border-top:1px solid #1E293B;">
        <p style="color:#94A3B8;font-size:13px;margin:0;">✓ No spike alerts this week</p>
       </td></tr>`;

  const body = `
    <tr><td style="padding:24px 32px;border-bottom:1px solid #1E293B;">
      <p style="color:#94A3B8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 4px;">Trinity World Water</p>
      <h2 style="color:#E2E8F0;font-size:22px;font-weight:800;margin:0 0 4px;letter-spacing:-0.5px;">Weekly Report</h2>
      <p style="color:#94A3B8;font-size:13px;margin:4px 0 0;">${p.weekStart} → ${p.weekEnd}</p>
    </td></tr>
    <tr><td style="padding:24px 32px;text-align:center;border-bottom:1px solid #1E293B;">
      <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;">Community Total (7 days)</p>
      <p style="color:#fff;font-size:28px;font-weight:900;margin:0;letter-spacing:-1px;">${fmt(p.communityTotal)}</p>
      <p style="margin:4px 0 0;">${pctLine(p.communityTotal, p.prevWeekTotal)}</p>
    </td></tr>
    <tr><td style="padding:24px 32px;border-bottom:1px solid #1E293B;">
      <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Per Tower Totals</p>
      <table width="100%" cellpadding="0" cellspacing="0">${towerRowsHtml(p.towerTotals)}</table>
    </td></tr>
    ${spikesHtml}`;

  return shell('#2563EB', `Weekly Water Report: ${p.weekStart} → ${p.weekEnd}`, body);
}

function monthlyHtml(p: {
  month: string;
  towerTotals: { tower: string; total: number }[];
  communityTotal: number;
  prevMonthTotal: number | null;
  spikeDays: number;
}): string {
  const maxVal = Math.max(...p.towerTotals.map(t => t.total), 1);
  const barsHtml = [...p.towerTotals]
    .sort((a, b) => b.total - a.total)
    .map(t => {
      const pct = Math.round((t.total / maxVal) * 100);
      const color = TOWER_COLORS[t.tower] ?? '#64748B';
      return `
        <tr><td style="padding:5px 0;">
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
        </td></tr>`;
    })
    .join('');

  const body = `
    <tr><td style="padding:24px 32px;border-bottom:1px solid #1E293B;">
      <p style="color:#94A3B8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 4px;">Trinity World Water</p>
      <h2 style="color:#E2E8F0;font-size:22px;font-weight:800;margin:0 0 4px;letter-spacing:-0.5px;">Monthly Report</h2>
      <p style="color:#94A3B8;font-size:13px;margin:4px 0 0;">${p.month}</p>
    </td></tr>
    <tr><td style="padding:24px 32px;text-align:center;border-bottom:1px solid #1E293B;">
      <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;">Total Community Consumption</p>
      <p style="color:#fff;font-size:28px;font-weight:900;margin:0;letter-spacing:-1px;">${fmt(p.communityTotal)}</p>
      <p style="margin:4px 0 0;">${pctLine(p.communityTotal, p.prevMonthTotal)}</p>
    </td></tr>
    <tr><td style="padding:24px 32px;border-bottom:1px solid #1E293B;">
      <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">Per Tower Totals — ${p.month}</p>
      <table width="100%" cellpadding="0" cellspacing="0">${barsHtml}</table>
    </td></tr>
    <tr><td style="padding:24px 32px;">
      <p style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">Month Summary</p>
      <p style="color:#94A3B8;font-size:13px;margin:0;">Spike alert days this month: <strong style="color:#FCA5A5;">${p.spikeDays}</strong></p>
    </td></tr>`;

  return shell('#7C3AED', `Monthly Water Report: ${p.month}`, body);
}

// ─── Send + log helper ────────────────────────────────────────────────────────

async function sendAndLog(opts: {
  alertType: string;
  subject: string;
  html: string;
  sheetDate?: string;
  label: string;
}): Promise<void> {
  const to = resolveRecipients([]); // sandbox → jacmani@gmail.com

  console.log(`\n${opts.label}`);
  console.log(`  FROM : ${FROM}`);
  console.log(`  TO   : ${to.join(', ')}`);
  console.log(`  SUBJ : ${opts.subject}`);
  console.log('  Sending…');

  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject: opts.subject,
    html: opts.html,
  });

  const status = error ? 'error' : 'sent';
  const details: Record<string, unknown> = error
    ? { error }
    : { resend_id: data?.id, sandbox: true, test: true };

  if (error) {
    console.error(`  ✗ Resend error:`, error);
  } else {
    console.log(`  ✓ sent  —  resend_id: ${data?.id}`);
  }

  const { error: dbErr } = await db.from('alert_log').insert({
    alert_type: opts.alertType,
    sheet_date: opts.sheetDate ?? null,
    tower: null,
    recipients: to,
    subject: opts.subject,
    status,
    details,
  });

  if (dbErr) {
    console.error(`  ✗ alert_log insert failed: ${dbErr.message}`);
  } else {
    console.log(`  alert_log row written (alert_type='${opts.alertType}') → /alerts`);
  }
}

// ─── Aggregation helpers ───────────────────────────────────────────────────────

const NULL_ID = '00000000-0000-0000-0000-000000000000';

async function aggregateTowers(sheetIds: string[]): Promise<{
  towerTotals: { tower: string; total: number }[];
  communityTotal: number;
}> {
  const ids = sheetIds.length > 0 ? sheetIds : [NULL_ID];
  const { data: rows } = await db
    .from('tower_consumption')
    .select('tower, total_ltrs')
    .in('sheet_id', ids);

  const map: Record<string, number> = {};
  let communityTotal = 0;
  for (const r of rows ?? []) {
    if (r.total_ltrs == null) continue;
    map[r.tower] = (map[r.tower] ?? 0) + r.total_ltrs;
    communityTotal += r.total_ltrs;
  }
  return {
    towerTotals: Object.entries(map).map(([tower, total]) => ({ tower, total })),
    communityTotal,
  };
}

async function prevTotal(startStr: string, endStr: string): Promise<number | null> {
  const { data: sheets } = await db
    .from('daily_sheets')
    .select('id')
    .gte('date', startStr)
    .lte('date', endStr)
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const ids = (sheets ?? []).map(s => s.id);
  if (!ids.length) return null;

  const { data: rows } = await db
    .from('tower_consumption')
    .select('total_ltrs')
    .in('sheet_id', ids);

  return (rows ?? []).reduce((s, r) => s + (r.total_ltrs ?? 0), 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('TW Water — dev report test');
  console.log('═══════════════════════════════════════');

  const today = new Date();
  const todayStr = fmtDate(today);

  // ── 1. Weekly report ───────────────────────────────────────────────────────
  // Last 7 days: today − 6 → today (inclusive)
  const weekEnd = new Date(today);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const weekStartStr = fmtDate(weekStart);
  const weekEndStr = todayStr;

  console.log(`\nWeekly range : ${weekStartStr} → ${weekEndStr}`);

  const { data: weekSheets } = await db
    .from('daily_sheets')
    .select('id, date')
    .gte('date', weekStartStr)
    .lte('date', weekEndStr)
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const weekSheetIds = (weekSheets ?? []).map(s => s.id);
  console.log(`  Sheets found: ${weekSheetIds.length}`);

  const { towerTotals: weekTowerTotals, communityTotal: weekCommunity } =
    await aggregateTowers(weekSheetIds);

  // Previous week for comparison
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setDate(weekStart.getDate() - 1);
  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setDate(prevWeekEnd.getDate() - 6);
  const prevWeekTotal = await prevTotal(fmtDate(prevWeekStart), fmtDate(prevWeekEnd));

  // Spikes this week from alert_log
  const { data: spikeAlerts } = await db
    .from('alert_log')
    .select('tower, sheet_date, details')
    .eq('alert_type', 'spike')
    .gte('sheet_date', weekStartStr)
    .lte('sheet_date', weekEndStr)
    .eq('status', 'sent');

  const spikesThisWeek = (spikeAlerts ?? []).map(a => ({
    tower: a.tower as string,
    date: a.sheet_date as string,
    pct: (a.details as { overagePct?: number })?.overagePct ?? 0,
  }));

  const weekSubject = `[TEST] Trinity World Water — Weekly Report (${weekStartStr} → ${weekEndStr})`;
  await sendAndLog({
    alertType: 'test-weekly',
    subject: weekSubject,
    html: weeklyHtml({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      towerTotals: weekTowerTotals,
      communityTotal: weekCommunity,
      prevWeekTotal,
      spikesThisWeek,
    }),
    sheetDate: weekEndStr,
    label: '── Weekly report ──',
  });

  // ── 2. Monthly report ──────────────────────────────────────────────────────
  // Current calendar month: 1st → today
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = fmtDate(monthStart);
  const monthEndStr = todayStr;
  const monthLabel = today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  console.log(`\nMonthly range: ${monthStartStr} → ${monthEndStr} (${monthLabel})`);

  const { data: monthSheets } = await db
    .from('daily_sheets')
    .select('id')
    .gte('date', monthStartStr)
    .lte('date', monthEndStr)
    .eq('processed_status', 'processed')
    .eq('superseded', false);

  const monthSheetIds = (monthSheets ?? []).map(s => s.id);
  console.log(`  Sheets found: ${monthSheetIds.length}`);

  const { towerTotals: monthTowerTotals, communityTotal: monthCommunity } =
    await aggregateTowers(monthSheetIds);

  // Previous month for comparison
  const prevMonthEnd = new Date(monthStart.getTime() - 1);
  const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
  const prevMonthTot = await prevTotal(fmtDate(prevMonthStart), fmtDate(prevMonthEnd));

  // Spike count this month
  const { count: spikeDays } = await db
    .from('alert_log')
    .select('id', { count: 'exact', head: true })
    .eq('alert_type', 'spike')
    .gte('sheet_date', monthStartStr)
    .lte('sheet_date', monthEndStr)
    .eq('status', 'sent');

  const monthSubject = `[TEST] Trinity World Water — Monthly Report: ${monthLabel}`;
  await sendAndLog({
    alertType: 'test-monthly',
    subject: monthSubject,
    html: monthlyHtml({
      month: monthLabel,
      towerTotals: monthTowerTotals,
      communityTotal: monthCommunity,
      prevMonthTotal: prevMonthTot,
      spikeDays: spikeDays ?? 0,
    }),
    sheetDate: monthEndStr,
    label: '── Monthly report ──',
  });

  console.log('\n═══════════════════════════════════════');
  console.log('Done. Check jacmani@gmail.com and /alerts.');
  console.log('═══════════════════════════════════════\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
