import { extractDateDDMMYYYY } from './dateParsing';

export interface OcrSpaceResult {
  fullText: string;
  words: string[];
  detectedDate: string | null;
  confidence: number;
  exitCode: number;
}

const EMPTY_RESULT: OcrSpaceResult = {
  fullText: '',
  words: [],
  detectedDate: null,
  confidence: 0,
  exitCode: -1,
};

interface OcrSpaceLine {
  LineText?: string;
  Words?: Array<{ WordText?: string }>;
}

interface OcrSpaceParsedResult {
  ParsedText?: string;
  FileParseExitCode?: number;
  TextOverlay?: { Lines?: OcrSpaceLine[] };
}

interface OcrSpaceResponse {
  OCRExitCode?: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ParsedResults?: OcrSpaceParsedResult[];
}

export async function extractTextWithOcrSpace(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<OcrSpaceResult> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    console.log('[ocr.space] OCR_SPACE_API_KEY not set — skipping');
    return EMPTY_RESULT;
  }

  // Map mediaType to OCR.space filetype param
  const filetypeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'jpg', // OCR.space converts
    'image/gif': 'gif',
  };
  const filetype = filetypeMap[mediaType] ?? 'jpg';
  const dataUri = `data:${mediaType};base64,${base64}`;

  console.log(`[ocr.space] Calling API, base64 size: ${(base64.length / 1024).toFixed(1)}KB, engine=2`);

  try {
    // OCR.space requires application/x-www-form-urlencoded for base64 uploads
    const params = new URLSearchParams({
      apikey: apiKey,
      base64Image: dataUri,
      OCREngine: '2',
      filetype,
      isOverlayRequired: 'true', // get word-level data
      detectOrientation: 'true',
      isTable: 'true', // sheet is tabular — improves layout recognition
      scale: 'true',
    });

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[ocr.space] HTTP error ${response.status}: ${errBody.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = (await response.json()) as OcrSpaceResponse;
    const exitCode = data.OCRExitCode ?? -1;
    console.log(`[ocr.space] OCRExitCode=${exitCode} IsErrored=${data.IsErroredOnProcessing}`);

    if (data.IsErroredOnProcessing) {
      const msg = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join('; ')
        : (data.ErrorMessage ?? 'unknown error');
      console.error(`[ocr.space] Processing error: ${msg}`);
      return { ...EMPTY_RESULT, exitCode };
    }

    const firstResult = data.ParsedResults?.[0];
    if (!firstResult) {
      console.warn('[ocr.space] No ParsedResults in response');
      return { ...EMPTY_RESULT, exitCode };
    }

    const fullText = firstResult.ParsedText ?? '';
    console.log(`[ocr.space] fullText length: ${fullText.length} chars`);

    // Extract individual words from TextOverlay (more reliable than splitting ParsedText)
    const words: string[] = [];
    const lines = firstResult.TextOverlay?.Lines ?? [];
    for (const line of lines) {
      for (const word of line.Words ?? []) {
        const w = word.WordText?.trim();
        if (w) words.push(w);
      }
    }

    // Fall back to splitting ParsedText if no overlay
    if (words.length === 0 && fullText) {
      words.push(...fullText.split(/\s+/).filter(Boolean));
    }

    const detectedDate = extractDateDDMMYYYY(fullText);
    console.log(`[ocr.space] words=${words.length}, detectedDate=${detectedDate ?? 'none'}`);

    return { fullText, words, detectedDate, confidence: 0.85, exitCode };
  } catch (err) {
    console.error('[ocr.space] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}
