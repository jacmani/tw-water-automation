# Trinity World Water Automation

Daily water consumption tracking system for Trinity World residential community. A technician photographs the handwritten meter reading sheet each morning; Claude Vision extracts every field; structured data lands in Postgres and surfaces on a dashboard for the Association committee.

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
3. Claude Vision reads every handwritten field and returns structured JSON (6 sections, 50+ values)
4. Data stored across 8 Postgres tables
5. Dashboard (`/`) shows live tower consumption cards, community totals, 7-day trend chart, and a live IST clock in the header
6. Three infographic templates export as animated GIF or PNG for WhatsApp sharing
7. Spike alerts email the committee automatically on every upload if any tower exceeds its 7-day average by ≥15%
8. Weekly and monthly summary reports run via Vercel Cron

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
│   ├── page.tsx                   # Dashboard (server component)
│   ├── upload/page.tsx            # Upload form (client component)
│   ├── history/page.tsx           # Consumption history (client component)
│   ├── committee/page.tsx         # Committee registry (server component)
│   ├── committee/admin/page.tsx   # Committee admin (client component)
│   ├── alerts/page.tsx            # Alert log (server component)
│   └── api/
│       ├── upload/route.ts        # POST: image → Supabase → Claude → DB
│       ├── upload/confirm/route.ts# POST: confirm extraction, fire spike alert
│       └── cron/
│           ├── weekly-report/     # Monday 08:00 IST
│           └── monthly-report/    # 1st of month 08:00 IST
├── components/
│   ├── dashboard/                 # TowerCard, TrendChart, SummaryRow, ISTClock, etc.
│   ├── history/                   # HistoryPage, DailyTable, HeatmapView, flagging, csvExport
│   ├── committee/                 # CommitteeAdmin
│   └── infographics/              # TemplateA (dark navy), TemplateB (pie), TemplateC (alert)
├── lib/
│   ├── supabase.ts                # DB queries
│   ├── anthropic.ts               # Claude Vision extraction
│   ├── email.ts                   # Resend client, spike/weekly/monthly templates
│   └── utils.ts                   # Helpers, tower colors, formatIST()
└── types/index.ts                 # All TypeScript types
supabase/migrations/               # SQL schema — run in order
vercel.json                        # Cron schedules
CLAUDE.md                          # Full project context for AI sessions
```

---

## Infographic Templates

| Template | Design | Trigger |
|----------|--------|---------|
| A — Daily Tower Card | Dark navy, per-tower, Trinity World photo background | Always (select tower) |
| B — Pie Chart | White/blue, all towers | Always |
| C — Alert Poster | Red/black, aggressive, photo background | Any tower ≥15% above 7-day avg |

All three export as **animated GIF** (Ken Burns zoom + number count-up, 22 frames) or static **PNG** at 2× resolution, suitable for WhatsApp sharing. Template A/C feature Trinity World background photos with dark overlay. All include a "Report a Leak / Call Maintenance" CTA block (9072624550).

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

- **Daily Table** — one expandable row per sheet. Collapsed view: date, input total, tower usage, diff, flag badge. Expanded: raw source readings + per-tower DO/DR values with confidence indicators (low-confidence values rendered italic+⚠).
- **Heatmap** — GitHub-style calendar, Community mode (community total deviation from mean) or Per Tower mode (4 independent heatmaps). Blue = below average, orange/red = above average.
- **Tower filter** — narrows heatmap and highlights expanded tower rows.
- **CSV export** — client-side, one row per date, all source/tower/confidence columns. Filename: `trinity-water-history_<start>_to_<end>.csv`.

**Cross-check flags** (computed live, not stored):

| Flag | Trigger |
|------|---------|
| `summary_misread` | `input_total` or `tower_usage` is null, or input_total >> WS sum |
| `digit_drop` | A DO row < 50 kL or DR row < 5 kL when peers are in normal range |
| `source_duplication` | Duplicate non-zero source totals and WS sum inflated vs input_total |
| `unexplained_gap` | TC sum or WS sum differs from recorded value by > 10 kL |
| `ok` | All sums within ±10 kL |

See `src/components/history/flagging.ts` for implementation and `CLAUDE.md` for full logic spec.

---

## Data Model

Eight tables in Postgres. See `CLAUDE.md` for every field.

| Table | Holds |
|-------|-------|
| `daily_sheets` | One row per upload — date, image URL, extraction status, confidence score |
| `tower_consumption` | DO + DR readings per tower per sheet (8 rows/sheet) |
| `water_sources` | Section 2 source/location rows per sheet |
| `water_levels` | Tank CM/% readings at 6AM, 12PM, 6PM, 12AM per sheet |
| `amenities` | Car Wash, Pool, Party Hall meter readings per sheet |
| `summary` | Section 6 totals — input, tower usage, diff per sheet |
| `committee_members` | Term-scoped registry of 10 committee roles with email/WhatsApp opt-in |
| `alert_log` | Every Resend email attempt — type, recipients, status, Resend ID |

---

## What Comes Next

- **Digital sheet entry** — direct form input by technician to reduce Vision extraction errors (Phase 2)
- **Production email** — domain verification in Resend, flip `RESEND_SANDBOX=false`
- **Association member login** — Supabase Auth, role-based dashboard access for GC Chairs
- **Resident portal integration** — single login, per-flat consumption insights
- **WhatsApp automation** — parked pending governance decision (WhatsApp Business API sustainability across committee terms)
