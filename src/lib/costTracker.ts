/**
 * Per-scan cost tracker — reports what each upload actually cost, in USD and INR.
 *
 * Philosophy of the v3.0 cost-inverted pipeline: free engines do the everyday work,
 * Claude is touched only on genuine disagreement. This tracker makes that visible in
 * the live SSE log so the committee can SEE that most scans cost ₹0 of paid API.
 *
 * Rates are approximate published API prices (June 2026). They are intentionally
 * conservative (slightly high) so the displayed cost is an upper bound, never an
 * under-estimate. Free engines are tracked too (as ₹0) so the log shows the full
 * engine roster, not just the paid ones.
 */

// USD → INR. Override with USD_INR_RATE env var if you want a live/locked rate.
const USD_TO_INR = Number(process.env.USD_INR_RATE) || 86; // ~₹86/USD mid-2026

// Per-million-token USD rates (input / output).
const RATES = {
  // Claude Haiku 4.5 — the ONLY paid model in v3.0 (Opus removed).
  'claude-haiku': { in: 1.0, out: 5.0 },
  // Claude Opus (kept for reference / legacy EXTRACTION_PRIMARY paths only).
  'claude-opus': { in: 5.0, out: 25.0 },
} as const;

export interface EngineCost {
  engine: string;       // human label, e.g. "Gemini 2.5 Flash"
  paid: boolean;        // false = free tier / free engine
  usd: number;          // cost of this engine call in USD
  detail?: string;      // token breakdown or note
}

export class CostTracker {
  private entries: EngineCost[] = [];

  /** Record a FREE engine call (cost ₹0) so the log shows the full roster. */
  addFree(engine: string, detail?: string) {
    this.entries.push({ engine, paid: false, usd: 0, detail });
  }

  /** Record a Claude (paid) call from real token usage. */
  addClaude(
    engine: string,
    usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined,
    rateKey: keyof typeof RATES = 'claude-haiku'
  ) {
    const inTok = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
    const outTok = usage?.output_tokens ?? 0;
    const r = RATES[rateKey];
    const usd = (inTok / 1_000_000) * r.in + (outTok / 1_000_000) * r.out;
    this.entries.push({
      engine,
      paid: true,
      usd,
      detail: `${inTok.toLocaleString()} in + ${outTok.toLocaleString()} out tokens`,
    });
  }

  get totalUsd(): number {
    return this.entries.reduce((s, e) => s + e.usd, 0);
  }

  get totalInr(): number {
    return this.totalUsd * USD_TO_INR;
  }

  get paidEngineCount(): number {
    return this.entries.filter(e => e.paid && e.usd > 0).length;
  }

  get breakdown(): EngineCost[] {
    return this.entries;
  }

  /** Format INR for display: ₹0.00 for free, ₹0.1842 for tiny paid amounts. */
  static formatInr(inr: number): string {
    if (inr === 0) return '₹0.00';
    if (inr < 1) return `₹${inr.toFixed(4)}`;
    return `₹${inr.toFixed(2)}`;
  }

  /** One-line summary for the SSE log header. */
  summaryLine(): string {
    const paid = this.paidEngineCount;
    const inr = CostTracker.formatInr(this.totalInr);
    if (paid === 0) {
      return `${inr} — all free engines, no paid API call 🎉`;
    }
    return `${inr} — ${paid} paid call${paid > 1 ? 's' : ''} (Claude Haiku)`;
  }

  /** Structured object for the `done` payload so the UI can render a cost card. */
  toJSON() {
    return {
      total_usd: Number(this.totalUsd.toFixed(6)),
      total_inr: Number(this.totalInr.toFixed(4)),
      usd_to_inr: USD_TO_INR,
      paid_calls: this.paidEngineCount,
      breakdown: this.entries.map(e => ({
        engine: e.engine,
        paid: e.paid,
        inr: Number((e.usd * USD_TO_INR).toFixed(4)),
        detail: e.detail,
      })),
    };
  }
}
