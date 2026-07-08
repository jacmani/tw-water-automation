/**
 * Parallel cross-validator — runs alongside Gemini on every upload, via the
 * Hugging Face Router (multi-provider). Independently reads tower totals,
 * water source totals, and the Section 6 summary fields. When two
 * architecturally different models agree on a digit, the probability of a
 * shared misread is extremely low.
 *
 * v3.1 expansion: now reads Section 2 (7 source totals) and Section 6
 * (input_total + tower_usage) in addition to Section 1 tower totals.
 * This closes the coverage gap for source_duplication and summary_misread
 * — the two most common failure modes.
 *
 * v3.2 (docs/ocr-audit-2026-07.md P0-1): this used to hard-code ONE model on
 * ONE provider (Qwen3-VL-8B-Instruct via novita). A live check against HF's
 * own API (2026-07) found that exact combination currently returns
 * `"status":"error"` in novita's own provider mapping — i.e. this engine, the
 * backbone of the entire free agreement gate, was silently failing on every
 * upload, independent of any billing/quota question. Same failure mode
 * openRouterVision.ts already handles for its own roster (free/available
 * models rotate without notice) — now handled here the same way: an ordered
 * list of {model, provider} candidates, tried in order until one succeeds.
 *
 * IMPORTANT — this does NOT multiply your free budget. When routing through
 * HF with just HF_TOKEN (no per-provider key), every provider's usage is
 * billed against the SAME shared HF Inference Provider credit ($0.10/mo on
 * free accounts) — Novita, Featherless, Together, DeepInfra, etc. all draw
 * from one pool, regardless of which one actually serves a given request.
 * Rotating candidates buys resilience against a single dead model/provider
 * (exactly the novita bug above) and against transient outages/rate limits —
 * it does NOT buy extra free quota once that shared credit is exhausted. If
 * every candidate starts failing at once with a billing-shaped error, that's
 * the real quota, not a rotation problem — see scripts/check-hf-quota.ts.
 *
 * Tolerance ratios: 0.85 for towers/summary (15% tolerance), 0.80 for
 * sources (25% tolerance — this class of model is less reliable on the
 * denser Section 2).
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
  model: string; // whichever candidate's label actually succeeded, e.g. "Qwen3-VL-8B (featherless-ai)"
}

interface HFCandidate {
  model: string;
  provider: string;
  label: string;
}

// Ordered by: (1) same model this engine was designed and tuned around, on the
// provider HF's own API currently reports as live; (2) the same model on its
// other live providers, in case featherless-ai has a bad day; (3) a
// well-tested, widely-available fallback model (google/gemma-4-31B-it is the
// same model OpenRouter's free roster already leans on, live on 4 providers
// per HF's API as of 2026-07 — novita/together/featherless-ai/deepinfra);
// (4) a purpose-built OCR model as a last resort — NOT prompt-tested against
// this codebase's structured-JSON extraction prompt as thoroughly as the
// general chat-tuned models above, so it's placed last rather than trusted
// as a primary.
//
// Verified live via https://huggingface.co/api/models/{id}?expand[]=inferenceProviderMapping
// on 2026-07-08 — this WILL go stale (exactly like OpenRouter's roster) and
// should be re-verified periodically the same way.
const HF_CANDIDATES: HFCandidate[] = [
  { model: 'Qwen/Qwen3-VL-8B-Instruct', provider: 'featherless-ai', label: 'Qwen3-VL-8B (featherless-ai)' },
  { model: 'Qwen/Qwen3-VL-8B-Instruct', provider: 'novita', label: 'Qwen3-VL-8B (novita)' }, // was erroring 2026-07-08, kept as a retry in case it recovers
  { model: 'google/gemma-4-31B-it', provider: 'novita', label: 'Gemma-4-31B (novita)' },
  { model: 'google/gemma-4-31B-it', provider: 'together', label: 'Gemma-4-31B (together)' },
  { model: 'google/gemma-4-31B-it', provider: 'deepinfra', label: 'Gemma-4-31B (deepinfra)' },
  { model: 'deepseek-ai/DeepSeek-OCR', provider: 'novita', label: 'DeepSeek-OCR (novita, experimental)' },
];

const EMPTY_RESULT: QwenVisionResult = {
  readings: [],
  sourceReadings: [],
  summaryInputTotal: null,
  summaryTowerUsage: null,
  rawText: '',
  success: false,
  model: 'none',
};

// Maps this prompt's short JSON key names → canonical location names (matching printed template labels).
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
IMPORTANT: "Total Litres" is a number written directly on the sheet by the
technician — transcribe the actual handwritten digits in that cell. Do NOT
calculate it yourself from the yesterday/today meter reading columns; the
technician's total does not always reconcile with (today − yesterday), and
substituting a computed value for what's actually written is a real extraction
error, not a fix.

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
• 2 vs 5 — a closed-loop "2" can look like "5", especially in compact 5-digit
  DR totals (expected range only 5,000–40,000). If a DR total looks like it's
  50,000+, re-examine whether the first digit is actually "2" not "5".
• Read each digit of a number individually rather than as a single shape —
  digits in a tightly-written row can visually bleed into each other.

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

/** Try exactly one {model, provider} candidate. Returns null on ANY failure — timeout, HTTP error, no JSON, bad JSON — so the caller can move on to the next candidate without special-casing failure types. */
async function tryOneCandidate(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  candidate: HFCandidate,
  hfToken: string
): Promise<QwenVisionResult | null> {
  console.log(`[hf-vision] Trying ${candidate.label}`);
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
    console.warn(`[hf-vision] ${candidate.label} timed out after 25s — trying next candidate`);
  }, 25_000);

  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      signal: ac.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        model: candidate.model,
        provider: candidate.provider,
        max_tokens: 600, // 18 values now (8 tower + 7 source + 2 summary), not 8
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: QWEN_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);

    if (!response.ok) {
      const err = await response.text();
      console.warn(`[hf-vision] ${candidate.label} API error ${response.status}: ${err.slice(0, 250)} — trying next candidate`);
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '';
    console.log(`[hf-vision] ${candidate.label} raw: ${raw.slice(0, 300)}`);

    // Strip <think>...</think> tags (some reasoning-tuned models emit these) before JSON extraction.
    const jsonMatch = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[hf-vision] ${candidate.label} returned no JSON — trying next candidate`);
      return null;
    }

    let parsed: Record<string, number | null>;
    try {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, number | null>;
    } catch {
      console.warn(`[hf-vision] ${candidate.label} returned unparseable JSON — trying next candidate`);
      return null;
    }

    const towers = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
    const types = ['DO', 'DR'] as const;
    const readings: QwenTowerReading[] = [];
    for (const tower of towers) {
      for (const type of types) {
        const val = parsed[`${tower}_${type}`];
        readings.push({ tower, type, total_ltrs: typeof val === 'number' ? val : null });
      }
    }

    const sourceReadings: QwenSourceReading[] = [];
    for (const [key, canonicalLocation] of Object.entries(SOURCE_KEY_MAP)) {
      const val = parsed[key];
      sourceReadings.push({ location: canonicalLocation, total: typeof val === 'number' ? val : null });
    }

    const summaryInputTotal = typeof parsed['input_total'] === 'number' ? parsed['input_total'] : null;
    const summaryTowerUsage = typeof parsed['tower_usage'] === 'number' ? parsed['tower_usage'] : null;

    const towerLog = readings.map(r => `${r.tower[0]}${r.type}=${r.total_ltrs != null ? (r.total_ltrs / 1000).toFixed(0) + 'k' : '?'}`).join(' ');
    const srcCount = sourceReadings.filter(s => s.total != null).length;
    console.log(`[hf-vision] ${candidate.label} ✓ Towers: ${towerLog}`);
    console.log(`[hf-vision] ${candidate.label} ✓ Sources: ${srcCount}/7 read | Summary: input=${summaryInputTotal} tower=${summaryTowerUsage}`);

    return {
      readings,
      sourceReadings,
      summaryInputTotal,
      summaryTowerUsage,
      rawText: raw,
      success: true,
      model: candidate.label,
    };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[hf-vision] ${candidate.label} error:`, err instanceof Error ? err.message : err, '— trying next candidate');
    return null;
  }
}

export async function extractTowerTotalsWithQwen(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<QwenVisionResult> {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    console.log('[hf-vision] HF_TOKEN not set — skipping HF parallel validator');
    return EMPTY_RESULT;
  }

  for (const candidate of HF_CANDIDATES) {
    const result = await tryOneCandidate(base64, mediaType, candidate, hfToken);
    if (result) return result;
  }

  console.warn('[hf-vision] All candidates failed — parallel validator unavailable for this upload. If this persists, run scripts/check-hf-quota.ts to check for a billing/quota issue.');
  return EMPTY_RESULT;
}
