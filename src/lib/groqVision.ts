/**
 * Groq FREE vision models — fallback free tie-breaker, used only when OpenRouter
 * (openRouterVision.ts) is unavailable (missing key, all candidates dead/rate-limited).
 *
 * Role: same job as the OpenRouter tie-breaker — a free THIRD opinion compared against
 * the primary (Gemini) and the HF parallel validator (Qwen) when those two disagree.
 * Deliberately reuses OpenRouterVisionResult's exact shape (readings/sourceReadings/
 * summaryInputTotal/summaryTowerUsage) so it's a drop-in substitute wherever
 * `openRouterResult` is consumed in anthropic.ts — resolveWithTieBreaker,
 * resolveSourceTieBreaker, resolveSummaryTieBreaker, findQwenDisagreements, and
 * checkSanity's independent-corroboration checks all accept either interchangeably.
 *
 * Added 2026-07-08 (docs/ocr-audit-2026-07.md follow-up — "awesome-free-llm-apis"
 * pass): github.com/mnfst/awesome-free-llm-apis lists Groq as a permanent free tier,
 * no credit card required, ultra-fast LPU inference. Verified directly against Groq's
 * own docs (console.groq.com/docs/vision, fetched live) — two vision-capable models
 * currently documented:
 *   - meta-llama/llama-4-scout-17b-16e-instruct (Meta lineage, 128K ctx, up to 5 images)
 *   - qwen/qwen3.6-27b (Qwen lineage, 131K ctx, thinking/non-thinking modes)
 * Using both as ordered candidates gives real architectural diversity (Meta vs Qwen)
 * within this one engine, on top of the diversity Groq already adds vs. Gemini/Qwen3-VL/
 * OpenRouter's Gemma-Nemotron roster.
 *
 * Not used as the PRIMARY tie-breaker (OpenRouter still goes first) because OpenRouter's
 * roster already gets exercised and re-verified every session; Groq is kept as a fresh,
 * independent fallback so a full OpenRouter outage doesn't force every disagreement
 * straight to paid Haiku. Skips gracefully if GROQ_API_KEY is unset — this project has
 * zero Groq API relationship until the user adds a free key (console.groq.com/keys, no
 * card required) to Vercel; until then this module is a documented no-op.
 */

import type { OpenRouterTowerReading, OpenRouterSourceReading, OpenRouterVisionResult } from './openRouterVision';

// Re-exported so callers can name the type accurately without implying an OpenRouter
// dependency; structurally identical to OpenRouterVisionResult (safe to use interchangeably).
export type GroqVisionResult = OpenRouterVisionResult;

const SOURCE_KEY_MAP: Record<string, string> = {
  'MV_Tanker':  'Mercury + Venus Tanker',
  'JN_Tanker':  'Jupiter + Neptune Tanker',
  'V_Well_123': 'Venus Side Well 1 2 3',
  'V_Well_4':   'Venus Side Well 4',
  'N_Well_5':   'Neptune Side Well 5',
  'N_Well_6':   'Neptune Side Well 6',
  'Open_Well':  'Open Well',
};

// Verified live against console.groq.com/docs/vision (2026-07-08) — both are current,
// documented, non-preview-only vision models. GROQ_MODEL env var, if set, tried first.
const MODEL_CANDIDATES = [
  process.env.GROQ_MODEL,
  'meta-llama/llama-4-scout-17b-16e-instruct', // Meta lineage, 128K ctx, up to 5 images/request
  'qwen/qwen3.6-27b',                          // Qwen lineage, 131K ctx — different family from Llama for real cross-validation
].filter(Boolean) as string[];

const EMPTY_RESULT: GroqVisionResult = {
  readings: [],
  sourceReadings: [],
  summaryInputTotal: null,
  summaryTowerUsage: null,
  rawText: '',
  success: false,
  model: MODEL_CANDIDATES[0] ?? 'none',
};

// Identical schema/prompt to openRouterVision.ts's PROMPT — kept as a separate copy
// (not imported) so this module has zero dependency on openRouterVision.ts's other
// internals, matching this codebase's existing convention (qwenVision.ts and
// openRouterVision.ts each keep their own copy rather than sharing one).
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

export async function extractTowerTotalsWithGroq(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<GroqVisionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log('[groq] GROQ_API_KEY not set — skipping Groq fallback tie-breaker');
    return EMPTY_RESULT;
  }

  for (const model of MODEL_CANDIDATES) {
    console.log(`[groq] Trying ${model} (fallback free tie-breaker)`);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      console.warn(`[groq] ${model} timed out after 20s — trying next candidate`);
    }, 20_000);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        signal: ac.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 550,
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
        if (response.status === 404 || response.status === 400) {
          console.warn(`[groq] ${model} unavailable (${response.status}) — trying next candidate`);
          continue;
        }
        // 429 (rate limit) / 5xx → no point trying more Groq models right now.
        console.error(`[groq] API error ${response.status}: ${err.slice(0, 200)}`);
        return EMPTY_RESULT;
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content ?? '';
      console.log(`[groq] ${model} raw: ${raw.slice(0, 200)}`);

      const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[groq] ${model} returned no JSON — trying next candidate`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;

      const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
      const types = ['DO', 'DR'] as const;
      const readings: OpenRouterTowerReading[] = [];
      for (const tower of towers) {
        for (const type of types) {
          const val = parsed[`${tower}_${type}`];
          readings.push({ tower, type, total_ltrs: typeof val === 'number' ? val : null });
        }
      }

      const sourceReadings: OpenRouterSourceReading[] = [];
      for (const [key, canonicalLocation] of Object.entries(SOURCE_KEY_MAP)) {
        const val = parsed[key];
        sourceReadings.push({ location: canonicalLocation, total: typeof val === 'number' ? val : null });
      }

      const summaryInputTotal = typeof parsed['input_total'] === 'number' ? parsed['input_total'] : null;
      const summaryTowerUsage = typeof parsed['tower_usage'] === 'number' ? parsed['tower_usage'] : null;

      console.log(`[groq] ✓ ${model}: towers`, readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));
      console.log(`[groq] ✓ ${model}: sources ${sourceReadings.filter(s => s.total != null).length}/7 | summary input=${summaryInputTotal} usage=${summaryTowerUsage}`);
      return { readings, sourceReadings, summaryInputTotal, summaryTowerUsage, rawText: raw, success: true, model };
    } catch (err) {
      clearTimeout(timer);
      console.error(`[groq] ${model} error:`, err instanceof Error ? err.message : err);
    }
  }

  console.warn('[groq] All candidate models failed — fallback tie-breaker unavailable');
  return EMPTY_RESULT;
}
