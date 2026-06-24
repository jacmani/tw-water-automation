/**
 * Mistral OCR 3 (mistral-ocr-2512) — purpose-built handwriting & table extractor.
 *
 * Role in the pipeline: feeds a structured text transcript of the sheet into
 * Claude Haiku's context window. Haiku reads BOTH the image pixels AND this
 * transcript — two independent signals for every number. If Mistral OCR reads
 * "1,76,000" and the image pixel path reads "1,16,000", Haiku can see the conflict
 * and prefer the OCR reading.
 *
 * Why Mistral OCR 3 (not Pixtral-12B):
 *   - Pixtral-12B is deprecated (no updates since Sep 2024, fine-text accuracy poor)
 *   - Mistral OCR 3 is purpose-built for handwriting: 88.9% handwriting accuracy
 *     vs Azure AI 78.2% on the same benchmark
 *   - Trained specifically on: dense tables, handwritten entries, boxes, labels
 *   - $0.002/page = ~$0.73/year for 365 daily uploads
 *   - Output is clean Markdown with table structure preserved
 *
 * API: POST https://api.mistral.ai/v1/ocr  (document understanding endpoint)
 * Auth: MISTRAL_API_KEY
 */

export interface MistralOcrResult {
  /** Markdown text extracted from the sheet, tables preserved */
  markdown: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Usage info for cost tracking */
  pages: number;
}

const EMPTY_RESULT: MistralOcrResult = {
  markdown: '',
  success: false,
  pages: 0,
};

export async function extractTextWithMistralOcr(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<MistralOcrResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('[mistral-ocr] MISTRAL_API_KEY not set — skipping');
    return EMPTY_RESULT;
  }

  console.log('[mistral-ocr] Calling mistral-ocr-2512 (Mistral OCR 3)');

  try {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-ocr-2512',
        document: {
          type: 'image_url',
          image_url: `data:${mediaType};base64,${base64}`,
        },
        include_image_base64: false, // we only need the text
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[mistral-ocr] API error ${response.status}: ${err.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = await response.json() as {
      pages?: Array<{ markdown?: string; index?: number }>;
      usage_info?: { pages_processed?: number };
    };

    // Concatenate all pages (sheet is usually 1 page)
    const markdown = (data.pages ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(p => p.markdown ?? '')
      .join('\n\n')
      .trim();

    const pages = data.usage_info?.pages_processed ?? (data.pages?.length ?? 1);

    if (!markdown) {
      console.warn('[mistral-ocr] Empty markdown returned');
      return { ...EMPTY_RESULT, success: false };
    }

    console.log(`[mistral-ocr] Extracted ${markdown.length} chars, ${pages} page(s)`);
    console.log(`[mistral-ocr] Preview: ${markdown.slice(0, 200)}`);

    return { markdown, success: true, pages };

  } catch (err) {
    console.error('[mistral-ocr] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
