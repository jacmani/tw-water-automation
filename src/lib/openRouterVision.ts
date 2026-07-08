/**
 * OpenRouter FREE vision models — tower/source/summary tie-breaker.
 *
 * Role: a free SECOND (and third-vs-Qwen) OPINION used only when the primary
 * (Gemini) and the HF parallel validator (qwenVision.ts) disagree. Reads the
 * same tower/source/summary fields so its output can be compared field-by-field.
 * If 2 of the 3 free engines agree on a disputed value, we accept it WITHOUT
 * paying for Claude.
 *
 * This is the middle rung of the cost-inverted waterfall:
 *   Gemini (free) + HF validator (free)  →  OpenRouter (free)  →  Claude Haiku (paid, last resort)
 *
 * v3.3 (docs/ocr-audit-2026-07.md, "go through everything in OpenRouter" pass,
 * 2026-07-08): queried OpenRouter's live catalog directly —
 * `GET https://openrouter.ai/api/v1/models`, filtered to entries whose id ends
 * in `:free` AND whose `architecture.input_modalities` includes `"image"`.
 * That is EVERY free vision-capable model OpenRouter currently lists — not a
 * guess from a blog post. Found 5: two Gemma 4 variants (the well-established
 * ones, each independently confirmed to have a dozen+ live serving endpoints
 * under their paid slugs — strong evidence of real infra behind them), an
 * NVIDIA Nemotron omni-modal reasoning model, a smaller NVIDIA Nemotron model
 * specifically described as built for "document intelligence" (a good
 * conceptual fit for this task despite being the smallest of the four), and
 * one pure content-safety/moderation classifier (excluded — wrong tool for
 * structured JSON extraction). Also added OpenRouter's own
 * `openrouter/free` meta-router (picks a live free model for you) as a final
 * catch-all, since it costs nothing extra to try before falling to paid Haiku.
 *
 * Why OpenRouter only as a tie-breaker (not primary):
 * - Free tier is ~20 RPM and 50 req/day (1,000/day after a one-time $10), and the
 *   free-model roster rotates — hard, and apparently faster than expected: this
 *   file's roster from just two OCR-audit sessions ago already needed replacing.
 *   Fine for occasional tie-breaking; riskier as a daily workhorse.
 * - OpenAI-compatible API → same fetch shape as qwenVision.ts.
 *
 * Override the whole roster with OPENROUTER_MODEL (tried first). Skips
 * gracefully if OPENROUTER_API_KEY is unset. Re-verify this list periodically
 * the same way — see the query above, or `scripts/check-openrouter-roster.ts`.
 */

export interface OpenRouterTowerReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

export interface OpenRouterSourceReading {
  location: string; // canonical location name matching template label, e.g. 'Mercury + Venus Tanker'
  total: number | null;
}

export interface OpenRouterVisionResult {
  readings: OpenRouterTowerReading[];         // 8 tower total_ltrs values
  sourceReadings: OpenRouterSourceReading[];  // 7 water source total values (Section 2)
  summaryInputTotal: number | null;           // Section 6 TOTAL COLLECTION
  summaryTowerUsage: number | null;           // Section 6 TOTAL USAGE
  rawText: string;
  success: boolean;
  model: string;
}

// Maps this prompt's short JSON key names → canonical location names (matching printed
// template labels) — same mapping qwenVision.ts uses, kept in sync deliberately so
// resolveSourceTieBreaker in anthropic.ts can join on `location` across both engines.
const SOURCE_KEY_MAP: Record<string, string> = {
  'MV_Tanker':  'Mercury + Venus Tanker',
  'JN_Tanker':  'Jupiter + Neptune Tanker',
  'V_Well_123': 'Venus Side Well 1 2 3',
  'V_Well_4':   'Venus Side Well 4',
  'N_Well_5':   'Neptune Side Well 5',
  'N_Well_6':   'Neptune Side Well 6',
  'Open_Well':  'Open Well',
};

// OpenRouter's free-model roster ROTATES — slugs disappear without notice (the old
// qwen/qwen2.5-vl-32b-instruct:free 404'd, then nvidia/nemotron-nano-12b-v2-vl:free
// also went dark). So we try an ordered list of currently-live free vision models
// until one responds, instead of hard-coding a single slug. Verified live against
// the OpenRouter models API (July 2026). OPENROUTER_MODEL, if set, is tried first.
// NOTE: this list WILL go stale again — recheck https://openrouter.ai/models?
// fmt=cards&max_price=0&modality=text%2Bimage-%3Etext periodically (see
// docs/ocr-audit-2026-07.md P0-2).
const MODEL_CANDIDATES = [
  process.env.OPENROUTER_MODEL,
  'google/gemma-4-31b-it:free',                          // dense 30.7B, 256K ctx — most broadly hosted (13 live endpoints on the paid slug)
  'google/gemma-4-26b-a4b-it:free',                       // MoE, ~31B quality at 3.8B active/token — same family, good 2nd opinion
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',   // 30B omni (text+image+video+audio), reasoning-tuned
  'nvidia/nemotron-nano-12b-v2-vl:free',                  // smaller (12B) but purpose-built for document intelligence
  'openrouter/free',                                      // meta-router: OpenRouter picks a live free model for you — last resort
].filter(Boolean) as string[];

const EMPTY_RESULT: OpenRouterVisionResult = {
  readings: [],
  sourceReadings: [],
  summaryInputTotal: null,
  summaryTowerUsage: null,
  rawText: '',
  success: false,
  model: MODEL_CANDIDATES[0] ?? 'none',
};

// Extended (mirrors qwenVision.ts's v3.1 expansion — see docs/ocr-audit-2026-07.md P0-3):
// this free tie-breaker used to read ONLY the 8 tower totals, which meant Section 2
// (water sources) and Section 6 (summary/accountability totals) — the two sections
// responsible for both documented production incidents — never got a genuine 3-way
// free tie-break, only a 2-way Qwen-vs-primary check before falling straight to paid
// escalation. Now reads all three sections so resolveSourceTieBreaker /
// resolveSummaryTieBreaker in anthropic.ts have something to compare against.
const PROMPT = `You are reading a handwritten daily water meter sheet from India.

Read THREE sections and return ALL values as plain integers (no commas, no units).
Indian number format: 1,76,000 = 176000 | 1,98,000 = 198000 | 2,54,000 = 254000

=== SECTION 1 — TOWER SECTION (top of sheet) ===
4 towers: Venus, Mercury, Neptune, Jupiter. Each has 2 rows: DO and DR.
Find the "Total Litres" column (3rd column) for each of the 8 rows.
IMPORTANT: this is a number written directly on the sheet — transcribe the actual
handwritten digits. Do NOT calculate it from the yesterday/today meter columns;
the technician's written total does not always match (today − yesterday), and
substituting a computed value for what's actually written is an extraction error.

=== SECTION 2 — SOURCE/LOCATION SECTION (middle of sheet) ===
7 source rows. Find the "Total" column (rightmost data column) for each:
  MV_Tanker  = Mercury + Venus Tanker   (row 1)
  JN_Tanker  = Jupiter + Neptune Tanker (row 2)
  V_Well_123 = Venus Side Well 1 2 3    (row 3)
  V_Well_4   = Venus Side Well 4        (row 4)
  N_Well_5   = Neptune Side Well 5      (row 5)
  N_Well_6   = Neptune Side Well 6      (row 6)
  Open_Well  = Open Well                (row 7)

=== SECTION 6 — TOTAL INFLOW TABLE (bottom of sheet) ===
A table with columns: WATER | WELL | TANKER | TOTAL COLLECTION | TOTAL USAGE | BALANCE
Read the MAIN data row (not the CUMULATIVE row below it):
  input_total  = TOTAL COLLECTION column (grand total, the largest number)
  tower_usage  = TOTAL USAGE column

CRITICAL — Handwritten digit confusion (look carefully):
• The digit 7 with a short crossbar looks identical to 1. Re-examine any number
  in the 100,000–200,000 range that starts with 1 — it may actually start with 7.
  e.g. 1,16,000 might actually be 1,76,000 = 176000.
• Similarly: 6 vs 0, 3 vs 8, 4 vs 9.
• 2 vs 5 — a closed-loop "2" can look like "5". DR (drinking water) totals are
  normally only 5,000–40,000 — if a DR total looks like 50,000+, re-check whether
  the leading digit is really "2" not "5".
• Read each digit of a number individually, left to right, before combining them
  into the final integer — digits in a tightly-written row can visually bleed
  into each other, and reading the whole string as one shape is how "1,76,000"
  becomes "1,16,000" or "3,62,000" becomes "9,62,000".

Return ONLY this JSON, no explanation, no markdown:
{
  "Venus_DO": <integer or null>, "Venus_DR": <integer or null>,
  "Mercury_DO": <integer or null>, "Mercury_DR": <integer or null>,
  "Neptune_DO": <integer or null>, "Neptune_DR": <integer or null>,
  "Jupiter_DO": <integer or null>, "Jupiter_DR": <integer or null>,
  "MV_Tanker": <integer or null>, "JN_Tanker": <integer or null>,
  "V_Well_123": <integer or null>, "V_Well_4": <integer or null>,
  "N_Well_5": <integer or null>, "N_Well_6": <integer or null>,
  "Open_Well": <integer or null>,
  "input_total": <integer or null>, "tower_usage": <integer or null>
}`;

export async function extractTowerTotalsWithOpenRouter(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<OpenRouterVisionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('[openrouter] OPENROUTER_API_KEY not set — skipping OpenRouter tie-breaker');
    return EMPTY_RESULT;
  }

  // Try each candidate model until one responds. 404 (dead slug) / 400 → try next.
  // Each attempt has a 20s timeout — OpenRouter can hang on slow free models.
  // NOTE: worst case (every candidate dead/hanging) is now ~5x20s=100s instead of
  // the old 3x20s=60s, since the roster grew from 3 to 5 real candidates. That's a
  // deliberate trade — this call only runs on the agreement-gate-failure path (not
  // every upload), and surviving a dead model matters more than shaving the rare
  // all-dead worst case. Revisit if that path is ever observed hitting a real
  // function-duration ceiling in production logs.
  for (const model of MODEL_CANDIDATES) {
    console.log(`[openrouter] Trying ${model} (free tie-breaker)`);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      console.warn(`[openrouter] ${model} timed out after 20s — trying next candidate`);
    }, 20_000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        signal: ac.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://tw-water-automation.vercel.app',
          'X-Title': 'TW Water Automation',
        },
        body: JSON.stringify({
          model,
          max_tokens: 550, // raised from 300 — now 18 values (8 tower + 7 source + 2 summary + 1 buffer), not 8
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
              ],
            },
          ],
        }),
      });
      clearTimeout(timer);

      if (!response.ok) {
        const err = await response.text();
        // Dead slug or bad request → move on to the next candidate.
        if (response.status === 404 || response.status === 400) {
          console.warn(`[openrouter] ${model} unavailable (${response.status}) — trying next candidate`);
          continue;
        }
        // Rate limit / server error → no point trying more free models right now.
        console.error(`[openrouter] API error ${response.status}: ${err.slice(0, 200)}`);
        return EMPTY_RESULT;
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content ?? '';
      console.log(`[openrouter] ${model} raw: ${raw.slice(0, 200)}`);

      const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[openrouter] ${model} returned no JSON — trying next candidate`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;

      // ── Tower readings (Section 1) ────────────────────────────────────────
      const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
      const types = ['DO', 'DR'] as const;
      const readings: OpenRouterTowerReading[] = [];
      for (const tower of towers) {
        for (const type of types) {
          const val = parsed[`${tower}_${type}`];
          readings.push({ tower, type, total_ltrs: typeof val === 'number' ? val : null });
        }
      }

      // ── Source readings (Section 2) — new ───────────────────────────────
      const sourceReadings: OpenRouterSourceReading[] = [];
      for (const [key, canonicalLocation] of Object.entries(SOURCE_KEY_MAP)) {
        const val = parsed[key];
        sourceReadings.push({ location: canonicalLocation, total: typeof val === 'number' ? val : null });
      }

      // ── Summary fields (Section 6) — new ────────────────────────────────
      const summaryInputTotal = typeof parsed['input_total'] === 'number' ? parsed['input_total'] : null;
      const summaryTowerUsage = typeof parsed['tower_usage'] === 'number' ? parsed['tower_usage'] : null;

      console.log(`[openrouter] ✓ ${model}: towers`, readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));
      console.log(`[openrouter] ✓ ${model}: sources ${sourceReadings.filter(s => s.total != null).length}/7 | summary input=${summaryInputTotal} usage=${summaryTowerUsage}`);
      return { readings, sourceReadings, summaryInputTotal, summaryTowerUsage, rawText: raw, success: true, model };
    } catch (err) {
      clearTimeout(timer);
      // AbortError = timeout; other errors = network/parse issues. Either way, try next.
      console.error(`[openrouter] ${model} error:`, err instanceof Error ? err.message : err);
      // try next candidate
    }
  }

  console.warn('[openrouter] All candidate models failed — tie-breaker unavailable');
  return EMPTY_RESULT;
}
