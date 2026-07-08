import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '/sessions/gracious-jolly-noether/mnt/tw-water-automation/.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: sheets, error: sheetErr } = await supabase
    .from('daily_sheets')
    .select('*')
    .eq('date', '2026-06-09')
    .order('created_at', { ascending: false });

  if (sheetErr) { console.error('sheet query error', sheetErr); return; }
  console.log(`Found ${sheets?.length ?? 0} sheet(s) for 2026-06-09`);
  console.log(JSON.stringify(sheets, null, 2));

  for (const sheet of sheets ?? []) {
    console.log(`\n=== Sheet ${sheet.id} (superseded=${sheet.superseded}, status=${sheet.processed_status}) ===`);
    const [{ data: tc }, { data: ws }, { data: summary }] = await Promise.all([
      supabase.from('tower_consumption').select('*').eq('sheet_id', sheet.id),
      supabase.from('water_sources').select('*').eq('sheet_id', sheet.id),
      supabase.from('summary').select('*').eq('sheet_id', sheet.id).single(),
    ]);
    console.log('tower_consumption:', JSON.stringify(tc, null, 2));
    console.log('water_sources:', JSON.stringify(ws, null, 2));
    console.log('summary:', JSON.stringify(summary, null, 2));

    const tcSum = (tc ?? []).reduce((s: number, r: any) => s + (r.total_ltrs ?? 0), 0);
    const wsSum = (ws ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0);
    console.log(`TC_sum=${tcSum} WS_sum=${wsSum} input_total=${summary?.input_total} tower_usage=${summary?.tower_usage} diff=${summary?.diff}`);
    console.log(`|TC_sum - tower_usage| = ${Math.abs(tcSum - (summary?.tower_usage ?? 0))}`);
    console.log(`|WS_sum - input_total| = ${Math.abs(wsSum - (summary?.input_total ?? 0))}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
