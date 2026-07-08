import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '/sessions/gracious-jolly-noether/mnt/tw-water-automation/.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: recentLog } = await supabase
    .from('daily_log')
    .select('log_date')
    .order('log_date', { ascending: false })
    .limit(1)
    .single();
  console.log('Most recent log_date:', recentLog?.log_date);

  const date = recentLog?.log_date as string;

  const [{ data: wl, error: wlErr }, { data: am }, { data: inflow }] = await Promise.all([
    supabase.from('water_level_readings').select('*').eq('log_date', date),
    supabase.from('amenity_meter_readings').select('*').eq('log_date', date),
    supabase.from('daily_inflow_summary').select('*').eq('log_date', date).single(),
  ]);

  console.log('\nwater_level_readings for', date, ':', JSON.stringify(wl, null, 2));
  console.log('water_level_readings error:', wlErr);
  console.log('\namenity_meter_readings count:', am?.length);
  console.log('daily_inflow_summary:', JSON.stringify(inflow, null, 2));

  // Also check last 10 days for water_level_readings to see if it's ever populated
  const { data: recentWL } = await supabase
    .from('water_level_readings')
    .select('log_date, time_slot, jupiter_do')
    .order('log_date', { ascending: false })
    .limit(15);
  console.log('\nRecent water_level_readings (any date):', JSON.stringify(recentWL, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
