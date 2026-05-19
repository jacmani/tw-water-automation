# Trinity World Water Automation

Daily water consumption tracking and automation system for Trinity World residential community. Processes handwritten meter reading sheets via AI vision, stores structured data, and surfaces insights for the Association and Tower GC Chairs.

## Live

**Dashboard:** https://tw-water-automation.vercel.app  
**Upload Sheet:** https://tw-water-automation.vercel.app/upload

---

## What It Does

1. Technician photographs the daily water sheet and opens `/upload` on their phone
2. Photo is uploaded to Supabase storage
3. Claude Vision API reads every field on the handwritten sheet and extracts structured JSON
4. Data is stored in Postgres across 6 tables
5. Dashboard at `/` shows real-time tower consumption cards, community totals, 7-day trend charts
6. Three infographic templates (PNG) are available for WhatsApp sharing

---

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/jacmani/tw-water-automation
cd tw-water-automation
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API (service role) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NEXT_PUBLIC_TECHNICIAN_PHONE` | Any phone number to show on infographic |

### 3. Supabase Setup

1. Create a new [Supabase](https://supabase.com) project
2. In the SQL editor, run the contents of `supabase/migrations/001_initial_schema.sql`
3. In **Storage**, create a new bucket named `sheet-images` and set it to **Public**

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

1. Push this repo to GitHub: `github.com/jacmani/tw-water-automation`
2. Go to [vercel.com](https://vercel.com) → New Project → import the repo
3. Add all environment variables from `.env.example` in the Vercel project settings
4. Deploy — Vercel auto-deploys on every push to `main`

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Dashboard (server component)
│   ├── upload/page.tsx       # Upload form (client component)
│   └── api/upload/route.ts   # POST: image → Claude → Supabase
├── components/
│   ├── dashboard/            # TowerCard, TrendChart, SummaryRow, etc.
│   └── infographics/         # TemplateA (dark navy), TemplateB (pie), TemplateC (alert)
├── lib/
│   ├── supabase.ts           # DB queries
│   ├── anthropic.ts          # Vision extraction
│   └── utils.ts              # Helpers, tower colors
└── types/index.ts            # All TypeScript types
supabase/migrations/          # SQL schema
CLAUDE.md                     # Full project context for AI sessions
```

---

## Infographic Templates

| Template | Design | Trigger |
|----------|--------|---------|
| A — Daily Tower Card | Dark navy, per-tower | Always (select which tower) |
| B — Pie Chart | White/blue, all towers | Always |
| C — Alert Poster | Red/black, aggressive | Any tower ≥15% above 7-day avg |

All export as PNG at 2× resolution, suitable for WhatsApp sharing.

---

## Data Model

Six tables in Postgres: `daily_sheets`, `tower_consumption`, `water_sources`, `water_levels`, `amenities`, `summary`. See `CLAUDE.md` for the full schema with every field name.

---

## What Comes Next

- Association member login + GC Chair role
- Historical trend reports and anomaly detection
- Automated alerts when consumption spikes
- Integration into Trinity World resident portal
