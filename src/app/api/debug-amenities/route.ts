import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const anonClient = createClient(url, key);
  const svcClient = createClient(url, svc);

  const date = '2026-06-20';

  const [anonResult, svcResult] = await Promise.all([
    anonClient.from('amenity_meter_readings').select('amenity_type,location,consumption').eq('log_date', date),
    svcClient.from('amenity_meter_readings').select('amenity_type,location,consumption').eq('log_date', date),
  ]);

  return NextResponse.json({
    date,
    anon: { data: anonResult.data, error: anonResult.error },
    svc: { data: svcResult.data, error: svcResult.error },
    env: { url: url?.slice(0, 30), hasAnonKey: !!key, hasSvcKey: !!svc },
  });
}
