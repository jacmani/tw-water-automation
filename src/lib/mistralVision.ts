/**
 * Mistral Small Vision — lightweight second-opinion extractor.
 *
 * Purpose: cross-validate Claude Haiku's tower total_ltrs values.
 * If Haiku and Mistral agree → accept without Opus.
 * If they disagree → caller escalates to Opus.
 *
 * We ask only for the 8 tower numbers (4 towers × DO/DR total_ltrs)
 * to keep the prompt tiny and tokens cheap.
 */

export interface MistralTowerReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

export interface MistralVisionResult {
  readings: MistralTowerReading[];
  rawText: string;
  success: boolean;
}

const EMPTY_RESULT: MistralVisionResult = {
  readings: [],
  rawText: '',
  success: false,
};

const MISTRAL_PROMPT = `You are reading a handwritten daily water meter sheet for Trinity World apartments in India.

Look ONLY at Section 1 — the Tower Section at the TOP of the sheet.
It has 4 towers (Venus, Mercury, Neptune, Jupiter), each with 2 rows (DO and DR).
Find the "Total Litres" column (3rd column) for each of the 8 rows.

CRITICAL — Indian number format: numbers use Indian commas, e.g. 1,76,000 = 176000, 1,98,000 = 198000.
CRITICAL — Digit confusion: handwritten 7 often looks like 1. If you see 1,16,000 but the context suggests 170k range, it may be 1,76,000 = 176000.
Output ALL values as plain integers (no commas).

Return ONLY this JSON, no explanation:
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

export async function extractTowerTotalsWithMistral(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<MistralVisionResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('[mistral] MISTRAL_API_KEY not set — skipping');
    return EMPTY_RESULT;
  }

  console.log(`[mistral] Calling mistral-small-latest, base64 size: ${(base64.length / 1024).toFixed(1)}KB`);

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        max_tokens: 256,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: MISTRAL_PROMPT,
              },
              {
                type: 'image_url',
                image_url: `data:${mediaType};base64,${base64}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[mistral] API error ${response.status}: ${err.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log(`[mistral] Raw response: ${raw.slice(0, 300)}`);

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[mistral] No JSON found in response');
      return { ...EMPTY_RESULT, rawText: raw };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;

    const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
    const types = ['DO', 'DR'] as const;
    const readings: MistralTowerReading[] = [];

    for (const tower of towers) {
      for (const type of types) {
        const key = `${tower}_${type}`;
        const val = parsed[key];
        readings.push({
          tower,
          type,
          total_ltrs: typeof val === 'number' ? val : null,
        });
      }
    }

    console.log('[mistral] Readings:', readings.map(r => `${r.tower} ${r.type}=${r.total_ltrs}`).join(', '));

    return { readings, rawText: raw, success: true };
  } catch (err) {
    console.error('[mistral] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
