/**
 * Qwen3-VL-8B via HuggingFace Router (Novita provider)
 *
 * Role: Parallel cross-validator — runs alongside Gemini on every upload.
 * Independently reads tower totals, water source totals, and the Section 6
 * summary fields. When two architecturally different models agree on a digit,
 * the probability of a shared misread is extremely low.
 *
 * v3.1 expansion: now reads Section 2 (7 source totals) and Section 6
 * (input_total + tower_usage) in addition to Section 1 tower totals.
 * This closes the coverage gap for source_duplication and summary_misread
 * — the two most common failure modes.
 *
 * Tolerance ratios: 0.85 for towers/summary (15% tolerance), 0.80 for
 * sources (25% tolerance — Qwen8B is less reliable on the denser Section 2).
 */

export interface QwenTowerReading {
  tower: 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
  type: 'DO' | 'DR';
  total_ltrs: number | null;
}

export interface QwenSourceReading {
  location: string; // canonical location name matching template label, e.g. 'Mercury + Venus Tanker'
  total: number | null;
}

export interface QwenVisionResult {
  readings: QwenTowerReading[];          // 8 tower total_ltrs values
  sourceReadings: QwenSourceReading[];   // 8 water source total values
  summaryInputTotal: number | null;      // Section 6 TOTAL COLLECTION
  summaryTowerUsage: number | null;      // Section 6 TOTAL USAGE
  rawText: string;
  success: boolean;
  model: string;
}

const EMPTY_RESULT: QwenVisionResult = {
  readings: [],
  sourceReadings: [],
  summaryInputTotal: null,
  summaryTowerUsage: null,
  rawText: '',
  success: false,
  model: 'Qwen/Qwen3-VL-8B-Instruct',
};

// Maps Qwen's short JSON key names → canonical location names (matching printed template labels).
const SOURCE_KEY_MAP: Record<string, string> = {
  'MV_Tanker':    'Mercury + Venus Tanker',
  'JN_Tanker':    'Jupiter + Neptune Tanker',
  'V_Well_123':   'Venus Side Well 1 2 3',
  'V_Well_4':     'Venus Side Well 4',
  'N_Well_5':     'Neptune Side Well 5',
  'N_Well_6':     'Neptune Side Well 6',
  'Open_Well':    'Open Well',
};

const QWEN_PROMPT = `You are reading a handwritten daily water meter sheet from India.

Read THREE sections and return ALL values as plain integers (no commas, no units).
Indian number format: 1,76,000 = 176000 | 1,98,000 = 198000 | 2,54,000 = 254000

=== SECTION 1 — TOWER SECTION (top of sheet) ===
4 towers: Venus, Mercury, Neptune, Jupiter. Each has 2 rows: DO and DR.
Find the "Total Litres" column (3rd column) for each of the 8 rows.

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

DIGIT CONFUSION — look carefully:
• 7 with short crossbar looks like 1 → "1,16,000" may be "1,76,000" = 176000
• 6 vs 0, 3 vs 8, 4 vs 9

Return ONLY this JSON, no explanation, no markdown:
{
  "Venus_DO": null, "Venus_DR": null,
  "Mercury_DO": null, "Mercury_DR": null,
  "Neptune_DO": null, "Neptune_DR": null,
  "Jupiter_DO": null, "Jupiter_DR": null,
  "MV_Tanker": null, "JN_Tanker": null,
  "V_Well_123": null, "V_Well_4": null,
  "N_Well_5": null, "N_Well_6": null,
  "Open_Well": null,
  "input_total": null, "tower_usage": null
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

  console.log('[qwen] Calling Qwen3-VL-8B-Instruct via HF router (novita) — extended coverage');

  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        provider: 'novita',
        max_tokens: 600, // increased from 300 — 18 values now instead of 8
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
    console.log(`[qwen] Raw response: ${raw.slice(0, 400)}`);

    // Strip <think>...</think> tags before JSON extraction
    const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[qwen] No JSON found in response');
      return { ...EMPTY_RESULT, rawText: raw };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;

    // ── Tower readings (existing) ─────────────────────────────────────────
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

    // ── Source readings (new) ─────────────────────────────────────────────
    const sourceReadings: QwenSourceReading[] = [];
    for (const [qwenKey, canonicalLocation] of Object.entries(SOURCE_KEY_MAP)) {
      const val = parsed[qwenKey];
      sourceReadings.push({
        location: canonicalLocation,
        total: typeof val === 'number' ? val : null,
      });
    }

    // ── Summary fields (new) ──────────────────────────────────────────────
    const summaryInputTotal = typeof parsed['input_total'] === 'number' ? parsed['input_total'] : null;
    const summaryTowerUsage = typeof parsed['tower_usage'] === 'number' ? parsed['tower_usage'] : null;

    const towerLog = readings.map(r => `${r.tower[0]}${r.type}=${r.total_ltrs != null ? (r.total_ltrs/1000).toFixed(0)+'k' : '?'}`).join(' ');
    const srcCount = sourceReadings.filter(s => s.total != null).length;
    console.log(`[qwen] Towers: ${towerLog}`);
    console.log(`[qwen] Sources: ${srcCount}/7 read | Summary: input=${summaryInputTotal} tower=${summaryTowerUsage}`);

    return {
      readings,
      sourceReadings,
      summaryInputTotal,
      summaryTowerUsage,
      rawText: raw,
      success: true,
      model: 'Qwen/Qwen3-VL-8B-Instruct',
    };

  } catch (err) {
    console.error('[qwen] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
