import Navbar from '@/components/Navbar';
import { createServerClient } from '@/lib/supabase';
import { formatMediumDate, formatIST } from '@/lib/utils';

export const revalidate = 30;

interface AlertLogRow {
  id: string;
  alert_type: string;
  sheet_date: string | null;
  tower: string | null;
  recipients: string[];
  subject: string | null;
  sent_at: string;
  status: string;
  details: Record<string, unknown>;
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === 'sent';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
        ok ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'
      }`}
    >
      {ok ? '✓ sent' : '✗ error'}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    spike: 'bg-red-900/50 text-red-300 border-red-800',
    weekly: 'bg-blue-900/50 text-blue-300 border-blue-800',
    monthly: 'bg-violet-900/50 text-violet-300 border-violet-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${styles[type] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
      {type}
    </span>
  );
}

export default async function AlertsPage() {
  const supabase = createServerClient();

  const { data: rows, error } = await supabase
    .from('alert_log')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(100);

  const logs = (rows ?? []) as AlertLogRow[];

  const isSandbox = process.env.RESEND_SANDBOX !== 'false';

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-1 flex items-center gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-300">Alert Log</h1>
          <p className="text-slate-500 text-xs mt-0.5">Email send history</p>
        </div>
        {isSandbox && (
          <span className="ml-auto bg-amber-900/40 border border-amber-700/50 text-amber-400 text-xs font-semibold px-2 py-1 rounded">
            Sandbox mode
          </span>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {isSandbox && (
          <div className="bg-amber-950/30 border border-amber-700/40 rounded-xl p-4 mb-5">
            <p className="text-amber-400 text-sm font-semibold">Resend sandbox mode active</p>
            <p className="text-amber-400/70 text-xs mt-1">
              All emails are routed to <strong>jacmani@gmail.com</strong> regardless of intended
              recipient. Set <code className="bg-amber-950/60 px-1 rounded">RESEND_SANDBOX=false</code> and add a
              verified Resend domain to enable production routing.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 mb-5">
            <p className="text-red-400 text-sm">Failed to load alert log: {error.message}</p>
            <p className="text-red-400/60 text-xs mt-1">
              Run migration <code>003_alert_log.sql</code> in Supabase if the table doesn&apos;t exist.
            </p>
          </div>
        )}

        {logs.length === 0 && !error && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-500 text-sm">No alerts sent yet.</p>
            <p className="text-slate-600 text-xs mt-1">
              Spike alerts fire automatically on sheet upload. Weekly / monthly reports run via Vercel Cron.
            </p>
          </div>
        )}

        {logs.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">Sent</th>
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">Type</th>
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">Sheet Date</th>
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">Tower</th>
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">To</th>
                    <th className="text-left text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row, i) => (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${i === logs.length - 1 ? 'border-b-0' : ''}`}
                    >
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {formatIST(row.sent_at, true)}
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge type={row.alert_type} />
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {row.sheet_date ? formatMediumDate(row.sheet_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {row.tower ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-xs">
                        <span
                          title={row.recipients.join(', ')}
                          className="cursor-help border-b border-dotted border-slate-600"
                        >
                          {row.recipients.length === 1
                            ? row.recipients[0]
                            : `${row.recipients.length} recipients`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                        {row.status === 'error' && row.details?.error != null && (
                          <p className="text-red-400/70 text-xs mt-0.5 max-w-[180px] truncate">
                            {String(row.details.error)}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Cron Schedule</p>
          <div className="flex items-center gap-3">
            <span className="bg-blue-900/40 text-blue-400 text-xs font-mono px-2 py-1 rounded">30 2 * * 1</span>
            <span className="text-slate-400 text-sm">Weekly report — Mondays 8:00 AM IST</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-violet-900/40 text-violet-400 text-xs font-mono px-2 py-1 rounded">30 2 1 * *</span>
            <span className="text-slate-400 text-sm">Monthly report — 1st of month 8:00 AM IST</span>
          </div>
          <p className="text-slate-600 text-xs">
            Both schedules run less than once per day — compatible with Vercel Hobby plan cron limits.
          </p>
        </div>
      </div>
    </main>
  );
}
