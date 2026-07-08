import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: recentSheet } = await supabase
    .from('daily_sheets').select('id, date').eq('processed_status','processed').eq('superseded', false)
    .order('date', { ascending: false }).limit(1).single();
  const { data: wl } = await supabase.from('water_levels').select('*').eq('sheet_id', recentSheet?.id).in('tank', ['JDO','CT']).order('time_slot');
  console.log('date:', recentSheet?.date);
  console.log(JSON.stringify(wl, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
