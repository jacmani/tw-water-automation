/**
 * OpenRouter FREE vision model — tower-totals tie-breaker.
 *
 * Role: a free SECOND OPINION used only when the primary (Gemini) and Qwen3-VL
 * disagree on tower totals. Reads the same 8 tower totals so its output can be
 * compared field-by-field against the other two free engines. If 2 of the 3 free
 * engines agree on a disputed value, we accept it WITHOUT paying for Claude.
 *
 * This is the middle rung of the cost-inverted waterfall:
 *   Gemini (free) + Qwen (free)  →  OpenRouter (free)  →  Claude Haiku (paid, last resort)
 *
 * Why OpenRouter only as a tie-breaker (not primary):
 * - Free tier is ~20 RPM and 50 req/day (1,000/day after a one-time $10), and the
 *   free-model roster rotates. Fine for occasional tie-breaking; riskier as a daily
 *   workhorse. Using it only on disagreement means rotation/downtime rarely bites.
 * - OpenAI-compatible API → same fetch shape as qwenVision.ts.
 *
 * Default model: qwen/qwen2.5-vl-32b-instruct:free (strong doc/OCR VLM, image input).
 * Override with OPENROUTER_MODEL. Skips gracefully if OPENROUTER_API_KEY is unset.
 */

export interface OpenRouterTowerReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

export interface OpenRouterVisionResult {
  readings: OpenRouterTowerReading[];
  rawText: string;
  success: boolean;
  model: string;
}

// OpenRouter's free-model roster ROTATES — slugs disappear without notice (the old
// qwen/qwen2.5-vl-32b-instruct:free now 404s). So we try an ordered list of currently-
// live free vision models until one responds, instead of hard-coding a single slug.
// Verified live against the OpenRouter models API (June 2026). OPENROUTER_MODEL, if set,
// is tried first.
const MODEL_CANDIDATES = [
  process.env.OPENROUTER_MODEL,
  'nvidia/nemotron-nano-12b-v2-vl:free',  // document/OCR-oriented VL, free
  'google/gemma-4-31b-it:free',            // Gemma 4 vision, free
  'google/gemma-4-26b-a4b-it:free',
].filter(Boolean) as string[];

const EMPTY_RESULT: OpenRouterVisionResult = {
  readings: [],
  rawText: '',
  success: false,
  model: MODEL_CANDIDATES[0] ?? 'none',
};

// Same focused prompt as Qwen — only the 8 tower totals, tight token budget.
const PROMPT = `You are reading a handwritten daily water meter sheet from India.

Look ONLY at Section 1 — the Tower Section at the TOP of the sheet.
It has 4 towers: Venus, Mercury, Neptune, Jupiter.
Each tower has 2 rows: DO (Domestic/overhead) and DR (Drinking water).
Find the "Total Litres" column (3rd column from left) for each of the 8 rows.
IMPORTANT: this is a number written directly on the sheet — transcribe the actual
handwritten digits. Do NOT calculate it from the yesterday/today meter columns;
the technician's written total does not always match (today − yesterday), and
substituting a computed value for what's actually written is an extraction error.

CRITICAL — Indian number format: commas follow Indian convention.
Examples: 1,76,000 = 176000 | 1,98,000 = 198000 | 2,54,000 = 254000
Output ALL values as plain integers (no commas, no units).

CRITICAL — Handwritten digit confusion (look carefully):
• The digit 7 with a short crossbar looks identical to 1. Re-examine any number
  in the 100,000–200,000 range that starts with 1 — it may actually start with 7.
  e.g. 1,16,000 might actually be 1,76,000 = 176000.
• Similarly: 6 vs 0, 3 vs 8, 4 vs 9.
• 2 vs 5 — a closed-loop "2" can look like "5". DR (drinking water) totals are
  normally only 5,000–40,000 — if a DR total looks like 50,000+, re-check whether
  the leading digit is really "2" not "5".

Return ONLY this JSON object, no explanation, no markdown:
{
  "Venus_DO": <integer or null>,
  "Venus_DR": <integer or null>,
  "Mercury_DO": <integer or null>,
  "Mercury_DR": <integer or null>,
  "Neptune_DO": <integer or null>,
  "Neptune_DR": <integer or null>,
  "Jupiter_DO": <integer or null>,
  "Jupiter_DR": <integer or null>
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
          max_tokens: 300,
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
      const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
      const types = ['DO', 'DR'] as const;
      const readings: OpenRouterTowerReading[] = [];
      for (const tower of towers) {
        for (const type of types) {
          const val = parsed[`${tower}_${type}`];
          readings.push({ tower, type, total_ltrs: typeof val === 'number' ? val : null });
        }
      }

      console.log(`[openrouter] ✓ ${model}:`, readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));
      return { readings, rawText: raw, success: true, model };
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
