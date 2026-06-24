# Trinity World Water Automation

Daily water consumption tracking system for Trinity World residential community. A technician photographs the handwritten meter reading sheet each morning; a five-engine AI pipeline extracts every field; structured data lands in Postgres and surfaces on a dashboard for the Association committee.

## Live

| Page | URL |
|------|-----|
| Dashboard | https://tw-water-automation.vercel.app |
| Upload Sheet | https://tw-water-automation.vercel.app/upload |
| Consumption History | https://tw-water-automation.vercel.app/history |
| Committee Registry | https://tw-water-automation.vercel.app/committee |
| Alert Log | https://tw-water-automation.vercel.app/alerts |

---

## What It Does

1. Technician photographs the daily water sheet and opens `/upload` on their phone
2. Photo uploads to Supabase Storage
3. Five AI engines run in parallel — Qwen3-VL-8B, Mistral OCR 3, Google Vision, OCR.space, and Claude Haiku — each reading the sheet independently
4. Claude Haiku extracts every handwritten field (6 sections, 50+ values) using the Mistral OCR transcript as a disambiguation hint
5. If Haiku and Qwen3-VL disagree on any tower reading, Claude Opus is escalated automatically
6. Data stored across 8 Postgres tables
7. Dashboard shows live tower consumption cards, community totals, 7-day trend chart, and a live IST clock
8. Three infographic templates export as animated GIF or PNG for WhatsApp sharing
9. Spike alerts email the committee automatically if any tower exceeds its 7-day average by ≥15%
10. Weekly and monthly summary reports run via Vercel Cron

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/jacmani/tw-water-automation
cd tw-water-automation
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (service role) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `HF_TOKEN` | huggingface.co/settings/tokens (free account, read scope) |
| `MISTRAL_API_KEY` | console.mistral.ai |
| `GOOGLE_CLOUD_VISION_API_KEY` | Google Cloud Console → Vision API |
| `OCR_SPACE_API_KEY` | ocr.space/ocrapi (free key sufficient) |
| `NEXT_PUBLIC_TECHNICIAN_PHONE` | Phone number shown on Template A infographic |
| `RESEND_API_KEY` | resend.com → API Keys |
| `RESEND_SANDBOX` | `true` (sandbox) or `false` (production) |
| `RESEND_DOMAIN` | Verified Resend domain (production only) |
| `CRON_SECRET` | Random secret — set same value in Vercel dashboard |

### 3. Supabase setup

1. Create a new [Supabase](https://supabase.com) project
2. In the SQL editor, run migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_committee_and_dedup.sql`
   - `supabase/migrations/003_alert_log.sql`
3. In **Storage**, create a bucket named `sheet-images` set to **Public**

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

1. Push to GitHub
2. Vercel → New Project → import repo
3. Add all env vars from step 2 in Vercel project settings
4. Deploy — Vercel auto-deploys on every push to `main`
5. Vercel Cron picks up `vercel.json` automatically (weekly + monthly reports)

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                        # Dashboard (server component)
│   ├── upload/page.tsx                 # Upload form with live engine log (client component)
│   ├── history/page.tsx                # Consumption history (client component)
│   ├── committee/page.tsx              # Committee registry (server component)
│   ├── committee/admin/page.tsx        # Committee admin (client component)
│   ├── alerts/page.tsx                 # Alert log (server component)
│   └── api/
│       ├── upload/route.ts             # POST: image → storage → all engines → pending response
│       ├── upload/stream/route.ts      # POST SSE: same pipeline with live log events
│       ├── upload/confirm/route.ts     # POST: commit extraction to DB, fire spike alert
│       └── cron/
│           ├── weekly-report/          # Monday 08:00 IST
│           └── monthly-report/         # 1st of month 08:00 IST
├── components/
│   ├── dashboard/                      # TowerCard, TrendChart, SummaryRow, ISTClock, etc.
│   ├── history/                        # HistoryPage, DailyTable, HeatmapView, flagging, csvExport
│   ├── committee/                      # CommitteeAdmin
│   └── infographics/                   # TemplateA (dark navy), TemplateB (pie), TemplateC (alert)
├── lib/
│   ├── anthropic.ts                    # Five-engine pipeline — Haiku, Opus, sanity checks, auto-correction
│   ├── qwenVision.ts                   # Qwen3-VL-8B via HuggingFace Router
│   ├── mistralOcr.ts                   # Mistral OCR 3 — handwriting transcript
│   ├── googleVision.ts                 # Google Vision word-level OCR
│   ├── ocrSpace.ts                     # OCR.space Engine 2
│   ├── extractionValidator.ts          # Cross-validates Claude output against OCR word lists
│   ├── mistralVision.ts                # Legacy Mistral Small + Gemma-4 (kept, not in main pipeline)
│   ├── email.ts                        # Resend — spike/weekly/monthly templates
│   ├── supabase.ts                     # DB client factory
│   └── utils.ts                        # Tower colors, formatIST(), helpers
└── types/index.ts                      # All TypeScript types
supabase/migrations/                    # SQL schema — run in order
scripts/re-extract.ts                   # Re-run extraction on flagged sheets
vercel.json                             # Cron schedules
CLAUDE.md                               # Full project context for AI agent sessions
```

---

## Five-Engine OCR Pipeline

Every upload runs five AI engines in parallel to handle handwritten digit confusion (the key failure mode is a handwritten 7 with a short crossbar being read as 1 — e.g. 1,76,000 misread as 1,16,000).

```
Phase 1 — Parallel:
  Qwen3-VL-8B       → 8 tower totals JSON    (different visual encoder to Claude)
  Mistral OCR 3     → full sheet Markdown     (handwriting specialist, 88.9% accuracy)
  Google Vision     → word-level tokens       (date + number corroboration)
  OCR.space Eng 2   → word-level tokens       (free, second opinion)

Phase 2 — Sequential:
  Claude Haiku      → full sheet extraction (image + Mistral OCR transcript as context hint)
    ├─ Qwen agrees (ratio ≥0.85) → Done. Opus not called.
    ├─ Qwen disagrees            → Claude Opus (also gets transcript) → sanity check
    │                               └─ Opus fails sanity → vol_today auto-correction
    ├─ Haiku sanity violation    → Claude Opus → sanity check → auto-correct if needed
    └─ Confidence < 0.80         → Claude Opus → sanity check
```

**Cost:** ~$0.007/upload · ~$2.55/year for 365 daily uploads.

---

## Infographic Templates

| Template | Design | Trigger |
|----------|--------|---------|
| A — Daily Tower Card | Dark navy, per-tower, Trinity World photo background | Always (select tower) |
| B — Pie Chart | White/blue, all towers, Recharts PieChart | Always |
| C — Alert Poster | Red/black, aggressive design | Any tower ≥15% above 7-day avg |

All three export as **animated GIF** (Ken Burns zoom + number count-up, 22 frames) or static **PNG** at 2× resolution, suitable for WhatsApp sharing. Background photos from `public/branding/tw-1.jpg` through `tw-8.jpg` with 78–84% dark overlay.

---

## Alerts & Reports

Emails are sent via [Resend](https://resend.com). Currently in **sandbox mode** — all emails route to `jacmani@gmail.com` regardless of intended recipient. Set `RESEND_SANDBOX=false` and add a verified Resend domain to enable production routing to committee members.

| Alert type | Trigger | Recipients (production) |
|------------|---------|------------------------|
| Spike alert | Every upload — fires per tower if >15% above 7-day avg | President, VP, Secretary, GC Chairs |
| Weekly report | Mondays 08:00 IST (`30 2 * * 1`) | All active committee members |
| Monthly report | 1st of month 08:00 IST (`30 2 1 * *`) | All active committee members |

Every send (success or error) is logged in `alert_log` and visible at `/alerts`. Cron jobs are compatible with the Vercel Hobby plan (max once per day).

---

## History Page

`/history` shows the full extraction record for any date range with:

- **Daily Table** — one expandable row per sheet. Collapsed: date, input total, tower usage, diff, flag badge, date source badge (AI/Manual). Expanded: raw source readings + per-tower DO/DR values with confidence indicators (low-confidence values shown italic + ⚠).
- **Heatmap** — GitHub-style calendar. Community mode (total deviation from mean) or Per Tower mode (4 independent heatmaps). Blue = below average, orange/red = above average.
- **Tower filter** — narrows heatmap and highlights expanded tower rows.
- **CSV export** — client-side, one row per date, all source/tower/confidence columns.

**Cross-check flags** (computed live, not stored):

| Flag | Trigger |
|------|---------|
| `summary_misread` | `input_total` or `tower_usage` is null, or input_total >> WS sum |
| `digit_drop` | A DO row < 50 kL or DR row < 5 kL when peers are in normal range |
| `source_duplication` | Duplicate non-zero source totals and WS sum inflated vs input_total |
| `unexplained_gap` | TC sum or WS sum differs from recorded value by > 10 kL |
| `ok` | All sums within ±10 kL |

---

## Data Model

Eight tables in Postgres. Full field specs in `CLAUDE.md`.

| Table | Holds |
|-------|-------|
| `daily_sheets` | One row per upload — date, image URL, status, confidence, date_source, superseded flag |
| `tower_consumption` | DO + DR readings per tower per sheet (8 rows/sheet) |
| `water_sources` | Section 2 source/location rows per sheet |
| `water_levels` | Tank CM/% readings at 6AM, 12PM, 6PM, 12AM per sheet (24 rows/sheet) |
| `amenities` | Car Wash, Pool, Party Hall meter readings per sheet |
| `summary` | Section 6 totals — input, tower usage, diff per sheet |
| `committee_members` | Term-scoped registry of 10 committee roles with email/WhatsApp opt-in |
| `alert_log` | Every Resend email attempt — type, recipients, status, Resend ID |

**Deduplication:** Multiple uploads for the same date are allowed. The most recently created is canonical (`superseded=false`). All queries filter `.eq('superseded', false)`.

---

## What Comes Next

- **Production email** — domain verification in Resend, flip `RESEND_SANDBOX=false`
- **Association member login** — Supabase Auth, role-based dashboard access for GC Chairs
- **Historical trend reports** — month-over-month, anomaly history, export to PDF
- **Resident portal integration** — single login, per-flat consumption insights
- **Automated daily reminder** — if no upload by 9AM, ping technician via SMS/WhatsApp Business API

---

## Version History

**v2.0.0 — Multi-Engine OCR AI Architecture (June 2026)**
Five-engine parallel pipeline (Qwen3-VL-8B + Mistral OCR 3 + Google Vision + OCR.space + Claude Haiku/Opus). Mistral OCR 3 transcript injected into Haiku context. Sanity checks on Opus escalation path. `vol_today` auto-correction when both models fail. Live SSE terminal log on upload page. Mercury digit confusion bug resolved on first upload without manual DB patch.

**v1.3.0 — Haiku + Prompt Caching + Google Vision**
Switched primary extractor from Opus to Haiku. Added prompt caching. Google Vision word-level OCR + extractionValidator cross-validation layer. Raised confidence threshold to 0.80.

**v1.2.0 — OCR.space + Mistral Small**
OCR.space Engine 2 integration (free). Mistral Small as tower-totals validator (replaced by Qwen3-VL in v2.0.0). Sanity ranges and violation detection.

**v1.1.0 — History, Committee, Alerts, Infographics**
`/history` with heatmap, flags, CSV export, dark/light mode. Committee registry + admin with term lifecycle. Three infographic templates with animated GIF export. Alert email system — spike, weekly, monthly. `/alerts` admin page.

**v1.0.0 — Initial Release**
Upload page, Claude Vision extraction, Supabase schema, dashboard, Vercel deployment.

---

---

## For AI Agents Working on This Codebase

Read this section after reading the rest of the file. The sections above give you the full picture of what the system does and how it works. The notes below cover operational constraints specific to working in an AI agent session.

### Critical invariants — do not break these

- **`superseded` column** — always filter `.eq('superseded', false)` when querying `daily_sheets` for dashboards, trends, or averages. Never omit this filter.
- **Tower colors** — Venus `#7C3AED`, Mercury `#2563EB`, Neptune `#059669`, Jupiter `#EA580C`. Used in infographics, cards, charts, heatmap. Do not change.
- **`RESEND_SANDBOX`** — must stay `true` unless the user explicitly instructs otherwise.
- **Do not rename** the Vercel project, GitHub repo, or Supabase project. URLs are hardcoded in Resend templates and committee communications.
- **`mistralVision.ts`** exists but is NOT called in the main pipeline. It is legacy code. Do not wire it back in.

### Git push method

The local git index.lock is stale in the sandbox — `git push` will fail. Always use the GitHub Contents API (PUT) with the PAT in this file's sister document `CLAUDE.md`. Fetch the current SHA for each file before pushing.

### The most important file

`src/lib/anthropic.ts` — the entire five-engine pipeline lives here. Before editing it, understand the three escalation paths (Qwen disagreement, sanity violation, low confidence) and the `applyCorrections()` auto-correction logic. The sanity check must run on the Opus result too, not just Haiku.

### Supabase migrations

Run manually in the Supabase SQL editor. Never auto-migrate. Migration 002 must exist before any code referencing `superseded` or `committee_members` is deployed. Migration 003 before email alerts work.

### Environment variable checklist

If a feature isn't working, check these first: `HF_TOKEN` (Qwen3-VL), `MISTRAL_API_KEY` (Mistral OCR 3), `GOOGLE_CLOUD_VISION_API_KEY` (Google Vision), `OCR_SPACE_API_KEY` (OCR.space). All four are optional — missing keys cause that engine to silently skip; the pipeline degrades gracefully but loses the cross-validation benefit.
