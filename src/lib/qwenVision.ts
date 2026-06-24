/**
 * Qwen3-VL-8B via HuggingFace Router (Novita provider)
 *
 * Role: Full parallel sheet extractor — runs ALONGSIDE Claude Haiku on every upload.
 * This is NOT a backup or validator. It independently reads the complete tower section
 * and returns the same structured JSON as Haiku. When both agree → trust without Opus.
 * When they disagree → escalate to Opus.
 *
 * Why Qwen3-VL-8B:
 * - Explicitly designed for OCR (32-language handwriting support, low-light/blur robust)
 * - $0.08/M tokens via Novita on HF router = ~$0.00012 per upload (365/yr = $0.04 total)
 * - 574ms first-token latency, 57 tok/s — fast enough for parallel execution
 * - OpenAI-compatible API via https://router.huggingface.co/v1
 * - Single HF_TOKEN key — no extra account needed
 *
 * Key insight: Qwen3-VL uses a different visual encoder (DeepStack) than Claude,
 * so it makes DIFFERENT digit-recognition errors. When two independent models with
 * different architectures agree on a number, the probability of a shared misread
 * on the same digit is extremely low.
 */

export interface QwenTowerReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

export interface QwenVisionResult {
  readings: QwenTowerReading[];
  rawText: string;
  success: boolean;
  model: string;
}

const EMPTY_RESULT: QwenVisionResult = {
  readings: [],
  rawText: '',
  success: false,
  model: 'Qwen/Qwen3-VL-8B-Instruct',
};

// Same focused prompt as Mistral — ask only for the 8 tower totals.
// Keeping it tight (max_tokens=300) holds cost to ~$0.00012/call.
const QWEN_PROMPT = `You are reading a handwritten daily water meter sheet from India.

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

export async function extractTowerTotalsWithQwen(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<QwenVisionResult> {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    console.log('[qwen] HF_TOKEN not set — skipping Qwen3-VL');
    return EMPTY_RESULT;
  }

  console.log('[qwen] Calling Qwen3-VL-8B-Instruct via HF router (novita)');

  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        provider: 'novita',        // cheapest: $0.08/M input
        max_tokens: 300,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: QWEN_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${base64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[qwen] API error ${response.status}: ${err.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log(`[qwen] Raw response: ${raw.slice(0, 300)}`);

    // Extract JSON — Qwen sometimes adds <think>...</think> tags before JSON
    const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[qwen] No JSON found in response');
      return { ...EMPTY_RESULT, rawText: raw };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;

    const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
    const types = ['DO', 'DR'] as const;
    const readings: QwenTowerReading[] = [];

    for (const tower of towers) {
      for (const type of types) {
        const val = parsed[`${tower}_${type}`];
        readings.push({
          tower,
          type,
          total_ltrs: typeof val === 'number' ? val : null,
        });
      }
    }

    console.log('[qwen] Readings:', readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));
    return { readings, rawText: raw, success: true, model: 'Qwen/Qwen3-VL-8B-Instruct' };

  } catch (err) {
    console.error('[qwen] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
