# Audio & Logo Status — Trinity World Water Video

Decisions made 2026-07-06 (see chat with Builder Mani):

## Logo
**Decision: text wordmark only.** No Trinity World logo file exists in Drive or this repo (confirmed via search). Do not reference `public/logo.png` / `public/logo.svg` — build all logo/end-card moments as styled "Trinity World" text (Playfair Display per script) instead of a staticFile() image.

## Voiceover (public/audio/committee-vo.mp3, technician-vo.mp3)
**Decision: proceed with estimated timing, real audio to follow.**
No TTS engine was available to generate these. Build scene timing off these word-count estimates (150 wpm) until real files are dropped in:

| File | Script source | Words | Estimated duration | Target |
|------|---------------|-------|---------------------|--------|
| committee-vo.mp3 | tw-water-video-assets/committee-narration.txt | 182 | ~73s | ~80s |
| technician-vo.mp3 | tw-water-video-assets/technician-narration.txt | 396 | ~158s | ~180s |

When the real MP3s are dropped into `public/audio/`, re-check actual duration via ffprobe/getAudioDurationInSeconds and adjust scene timing — don't assume the estimate above is exact.

## Background music (public/audio/background-music.mp3)
**Not downloaded — needs manual step.** Pixabay blocks scripted/automated downloads (no direct file URL exposed, bot-protected). Recommended track, confirmed free for this non-commercial use, no attribution required:

- **Calm Corporate Business** — PaulYudin, 2:43 — https://pixabay.com/music/corporate-calm-corporate-business-153895/

Alternates if that one doesn't fit the cut:
- Corporate Background Music – Calm Focus — JoyInSound, 1:19 — https://pixabay.com/music/corporate-corporate-background-music-calm-focus-507152/
- Calm Corporate — Megisss, 3:19 — https://pixabay.com/music/corporate-calm-corporate-450167/

Download via the "Free Download" button on the track page and save as `public/audio/background-music.mp3`.
