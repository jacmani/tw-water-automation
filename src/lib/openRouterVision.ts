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

const MODEL = process.env.OPENROUTER_MODEL ?? 'qwen/qwen2.5-vl-32b-instruct:free';

const EMPTY_RESULT: OpenRouterVisionResult = {
  readings: [],
  rawText: '',
  success: false,
  model: MODEL,
};

// Same focused prompt as Qwen — only the 8 tower totals, tight token budget.
const PROMPT = `You are reading a handwritten daily water meter sheet from India.

Look ONLY at Section 1 — the Tower Section at the TOP of the sheet.
It has 4 towers: Venus, Mercury, Neptune, Jupiter.
Each tower has 2 rows: DO (Domestic/overhead) and DR (Drinking water).
Find the "Total Litres" column (3rd column from left) for each of the 8 rows.

CRITICAL — Indian number format: commas follow Indian convention.
Examples: 1,76,000 = 176000 | 1,98,000 = 198000 | 2,54,000 = 254000
Output ALL values as plain integers (no commas, no units).

CRITICAL — Handwritten digit confusion (look carefully):
• The digit 7 with a short crossbar looks identical to 1. Re-examine any number
  in the 100,000–200,000 range that starts with 1 — it may actually start with 7.
  e.g. 1,16,000 might actually be 1,76,000 = 176000.
• Similarly: 6 vs 0, 3 vs 8, 4 vs 9.

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

  console.log(`[openrouter] Calling ${MODEL} (free tie-breaker)`);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // OpenRouter recommends these for free-tier attribution; harmless if generic.
        'HTTP-Referer': 'https://tw-water-automation.vercel.app',
        'X-Title': 'TW Water Automation',
      },
      body: JSON.stringify({
        model: MODEL,
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

    if (!response.ok) {
      const err = await response.text();
      console.error(`[openrouter] API error ${response.status}: ${err.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log(`[openrouter] Raw response: ${raw.slice(0, 300)}`);

    const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[openrouter] No JSON found in response');
      return { ...EMPTY_RESULT, rawText: raw };
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

    console.log('[openrouter] Readings:', readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));
    return { readings, rawText: raw, success: true, model: MODEL };
  } catch (err) {
    console.error('[openrouter] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
