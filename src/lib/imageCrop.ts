/**
 * Targeted high-resolution crop, used ONLY on the paid Haiku escalation call
 * (docs/ocr-audit-2026-07.md P2-1).
 *
 * Why this exists: Claude's vision API auto-downscales any image to 1568px on
 * its longest edge server-side, regardless of what's sent — so simply sending a
 * bigger photo doesn't give Haiku a better look at the sheet. What DOES help is
 * sending a crop of just the disputed region: the same 1568px budget now covers
 * a much smaller physical area of the sheet, which is exactly the "zoom in and
 * look carefully" a human would do when a handwritten digit is ambiguous.
 *
 * The sheet's printed layout is fixed (see CLAUDE.md "The Physical Sheet"):
 * Section 1 (Tower table) is always at the top, Section 6 (Total Inflow) is
 * always at the bottom, Section 2 (Source/Location) sits in the middle. Photo
 * framing varies day to day (rotation, zoom, tilt), so these crop bands are
 * deliberately generous (not tight bounding boxes) to stay tolerant of that
 * variance — better to include a bit of a neighboring section than to miss the
 * target one.
 *
 * Fails closed: any error (corrupt image, sharp not available, etc.) returns
 * null and the caller falls back to the no-crop behavior that existed before
 * this file — this must never be able to block the escalation call itself.
 */

export type CropRegion = 'top' | 'middle' | 'bottom';

export interface CroppedImage {
  base64: string;
  mediaType: 'image/jpeg';
  label: string;
}

// Generous vertical bands (fraction of full image height), full width.
// Overlapping on purpose — cheap insurance against framing variance.
const BANDS: Record<CropRegion, { startFrac: number; endFrac: number; label: string }> = {
  top: {
    startFrac: 0,
    endFrac: 0.38,
    label: 'ZOOMED CROP: TOP of the sheet (Section 1 — Tower table, Venus/Mercury/Neptune/Jupiter DO+DR rows). Same sheet, higher magnification for digit clarity.',
  },
  middle: {
    startFrac: 0.30,
    endFrac: 0.68,
    label: 'ZOOMED CROP: MIDDLE of the sheet (Section 2 — Source/Location table). Same sheet, higher magnification for digit clarity.',
  },
  bottom: {
    startFrac: 0.66,
    endFrac: 1.0,
    label: 'ZOOMED CROP: BOTTOM of the sheet (Section 6 — TOTAL INFLOW table). Same sheet, higher magnification for digit clarity.',
  },
};

/**
 * Crop one generous horizontal band from the full sheet image, full width,
 * re-encoded as JPEG. Returns null on any failure (never throws).
 */
export async function cropRegion(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  region: CropRegion
): Promise<CroppedImage | null> {
  try {
    const sharp = (await import('sharp')).default;
    const buffer = Buffer.from(base64, 'base64');
    const image = sharp(buffer, { failOn: 'none' }).rotate(); // .rotate() with no args = auto-orient from EXIF
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      console.warn(`[imageCrop] Could not read dimensions for region=${region} — skipping crop`);
      return null;
    }

    const band = BANDS[region];
    const top = Math.round(height * band.startFrac);
    const cropHeight = Math.round(height * (band.endFrac - band.startFrac));
    if (cropHeight < 50) {
      console.warn(`[imageCrop] Computed crop height too small (${cropHeight}px) for region=${region} — skipping`);
      return null;
    }

    const cropped = await image
      .extract({ left: 0, top, width, height: cropHeight })
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`[imageCrop] Cropped region=${region}: ${width}x${cropHeight} (from ${width}x${height}), ${(cropped.length / 1024).toFixed(0)}KB`);
    return { base64: cropped.toString('base64'), mediaType: 'image/jpeg', label: band.label };
  } catch (err) {
    console.warn(`[imageCrop] Failed to crop region=${region}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Crop multiple regions in parallel. Failures for individual regions are
 * dropped silently (each already logs its own warning) — returns whatever
 * succeeded, which may be an empty array.
 */
export async function cropRegions(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  regions: CropRegion[]
): Promise<CroppedImage[]> {
  const unique = Array.from(new Set(regions));
  const results = await Promise.all(unique.map(r => cropRegion(base64, mediaType, r)));
  return results.filter((r): r is CroppedImage => r !== null);
}
