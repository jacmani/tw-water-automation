interface VisionSymbol {
  text: string;
}

interface VisionWord {
  symbols: VisionSymbol[];
  confidence?: number;
}

interface VisionParagraph {
  words: VisionWord[];
}

interface VisionBlock {
  paragraphs: VisionParagraph[];
}

interface VisionPage {
  blocks: VisionBlock[];
}

interface VisionFullTextAnnotation {
  text: string;
  pages: VisionPage[];
}

interface VisionAnnotateResponse {
  responses: Array<{
    fullTextAnnotation?: VisionFullTextAnnotation;
    error?: { code: number; message: string; status: string };
  }>;
}

export interface GoogleVisionResult {
  fullText: string;
  words: string[];
  detectedDate: string | null;
  confidence: number;
}

const EMPTY_RESULT: GoogleVisionResult = {
  fullText: '',
  words: [],
  detectedDate: null,
  confidence: 0,
};

export async function extractTextFromImage(base64: string): Promise<GoogleVisionResult> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    console.log('[vision] GOOGLE_CLOUD_VISION_API_KEY not set — skipping');
    return EMPTY_RESULT;
  }

  console.log(`[vision] Calling API, base64 size: ${(base64.length / 1024).toFixed(1)}KB`);

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[vision] API error ${response.status}: ${errBody.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = (await response.json()) as VisionAnnotateResponse;
    console.log(`[vision] Response received, responses count: ${data.responses?.length ?? 0}`);

    const firstResp = data.responses?.[0];

    // Check for Vision-level errors (API returns 200 but with error field)
    if (firstResp?.error) {
      console.error(`[vision] Vision response error: ${firstResp.error.code} ${firstResp.error.message}`);
      return EMPTY_RESULT;
    }

    const annotation = firstResp?.fullTextAnnotation;
    if (!annotation) {
      console.warn('[vision] No fullTextAnnotation — image may be unreadable, too dark, or upside-down');
      return EMPTY_RESULT;
    }

    console.log(`[vision] fullText length: ${annotation.text?.length ?? 0} chars`);

    const fullText = annotation.text ?? '';
    const words: string[] = [];
    let totalConf = 0;
    let wordCount = 0;

    for (const page of annotation.pages ?? []) {
      for (const block of page.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const word of para.words ?? []) {
            const wordText = (word.symbols ?? []).map(s => s.text).join('');
            if (wordText) {
              words.push(wordText);
              totalConf += word.confidence ?? 0;
              wordCount++;
            }
          }
        }
      }
    }

    const detectedDate = extractDate(fullText);
    console.log(`[vision] words: ${wordCount}, avgConf: ${wordCount > 0 ? (totalConf/wordCount).toFixed(2) : 0}, detectedDate: ${detectedDate ?? 'none'}`);

    return {
      fullText,
      words,
      detectedDate,
      confidence: wordCount > 0 ? totalConf / wordCount : 0,
    };
  } catch (err) {
    console.error('[vision] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}

function extractDate(text: string): string | null {
  // DD/MM/YYYY or D/M/YYYY
  let m = text.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // DD/MM/YY or D/M/YY
  m = text.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})\b/);
  if (m) {
    const [, d, mo, y] = m;
    const year = parseInt(y, 10) < 50 ? `20${y}` : `19${y}`;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}
