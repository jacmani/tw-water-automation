import type { Flag, HTowerRow, HSourceRow, HSummary } from './types';

const TOLERANCE = 10_000; // ±10 kL considered "within rounding"

function kl(n: number): string {
  return `${(n / 1000).toFixed(1)} kL`;
}

export function computeFlag(
  summary: HSummary | null,
  tc: HTowerRow[],
  ws: HSourceRow[],
): Flag {
  const inputTotal = summary?.input_total ?? null;
  const towerUsage = summary?.tower_usage ?? null;

  const wsSum = ws.reduce((s, r) => s + (r.total ?? 0), 0);
  const tcSum = tc.reduce((s, r) => s + (r.total_ltrs ?? 0), 0);

  // ── Priority 1: Summary misread ───────────────────────────────────────────
  if (inputTotal === null || towerUsage === null) {
    return {
      type: 'summary_misread',
      label: 'Summary misread',
      detail: 'input_total or tower_usage is null — extraction likely failed on Section 6',
    };
  }
  if (wsSum > 1_000 && inputTotal > wsSum * 1.5) {
    return {
      type: 'summary_misread',
      label: 'Summary misread',
      detail: `input_total ${kl(inputTotal)} >> WS sum ${kl(wsSum)} — label anchor likely misread`,
    };
  }

  // ── Priority 2: Digit drop ────────────────────────────────────────────────
  const doRows = tc.filter(r => r.type === 'DO' && r.total_ltrs != null && r.total_ltrs > 0);
  const drRows = tc.filter(r => r.type === 'DR' && r.total_ltrs != null && r.total_ltrs > 0);
  const normalDO = doRows.filter(r => r.total_ltrs! >= 50_000);
  const lowDO = doRows.find(r => r.total_ltrs! < 50_000);
  const normalDR = drRows.filter(r => r.total_ltrs! >= 5_000);
  const lowDR = drRows.find(r => r.total_ltrs! < 5_000);

  if (normalDO.length > 0 && lowDO) {
    return {
      type: 'digit_drop',
      label: 'Digit drop',
      detail: `${lowDO.tower} DO appears as ${kl(lowDO.total_ltrs!)}, expected ≥50 kL — possible dropped digit`,
    };
  }
  if (normalDR.length > 0 && lowDR) {
    return {
      type: 'digit_drop',
      label: 'Digit drop',
      detail: `${lowDR.tower} DR appears as ${kl(lowDR.total_ltrs!)}, expected ≥5 kL — possible dropped digit`,
    };
  }

  // ── Priority 3: Source duplication ───────────────────────────────────────
  const sourceTotals = ws.map(r => r.total).filter((t): t is number => t != null && t > 0);
  if (
    sourceTotals.length > 1 &&
    new Set(sourceTotals).size < sourceTotals.length &&
    wsSum > inputTotal * 1.1
  ) {
    return {
      type: 'source_duplication',
      label: 'Source dup',
      detail: `WS sum ${kl(wsSum)} >> input_total ${kl(inputTotal)} with duplicate source row values — Vision duplication`,
    };
  }

  // ── Priority 4: OK vs Unexplained gap ────────────────────────────────────
  const tcOk = Math.abs(tcSum - towerUsage) <= TOLERANCE;
  const wsOk = wsSum < 1_000 || Math.abs(wsSum - inputTotal) <= TOLERANCE;

  if (tcOk && wsOk) {
    return {
      type: 'ok',
      label: 'OK',
      detail: `TC sum ${kl(tcSum)} ≈ tower_usage ${kl(towerUsage)}, WS sum ≈ input_total — all consistent`,
    };
  }

  const parts: string[] = [];
  if (!tcOk) {
    const d = tcSum - towerUsage;
    parts.push(`Output Δ ${d > 0 ? '+' : ''}${kl(d)} (TC ${kl(tcSum)} vs recorded ${kl(towerUsage)})`);
  }
  if (!wsOk) {
    const d = wsSum - inputTotal;
    parts.push(`Input Δ ${d > 0 ? '+' : ''}${kl(d)} (WS ${kl(wsSum)} vs input_total ${kl(inputTotal)})`);
  }
  return {
    type: 'unexplained_gap',
    label: 'Gap',
    detail: parts.join(' · '),
  };
}
