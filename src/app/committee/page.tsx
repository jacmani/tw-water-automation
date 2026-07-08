import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { getCurrentCommitteeTerm, getCommitteeMembers } from '@/lib/supabase';
import { TOWER_COLORS, TOWER_TEXT_CLASSES } from '@/lib/utils';
import type { CommitteeMember, TowerName, CommitteeRole } from '@/types';
import { TOWERS } from '@/lib/utils';

export const revalidate = 300;

const OFFICE_BEARER_ROLE_SET = new Set<CommitteeRole>([
  'President', 'Vice President', 'Secretary', 'Joint Secretary',
  'Treasurer', 'Joint Treasurer', 'Technical Expert', 'Financial Expert',
]);

const ROLE_ORDER: Record<CommitteeRole, number> = {
  'President': 0, 'Vice President': 1, 'Secretary': 2, 'Joint Secretary': 3,
  'Treasurer': 4, 'Joint Treasurer': 5, 'Technical Expert': 6, 'Financial Expert': 7,
  'GC Chair': 8, 'GC Member': 9,
};

// P2-5: phone numbers were plain, unclickable text — a resident reading the
// committee page on their phone had to manually copy/retype the number to
// call or message someone. digitsOnly + a conditional country-code prefix
// handles numbers stored with or without "+91"/"91" (phone is stored
// as-entered per CLAUDE.md, only validated client-side on the admin form).
function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}
function withCountryCode(phone: string): string {
  const d = digitsOnly(phone);
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, '');
}

function WhatsAppIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.24.68-1.4 1.3-1.93 1.35-.5.05-1 .24-3.34-.72-2.83-1.16-4.65-4.05-4.79-4.24-.14-.19-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.35.26-.28.56-.35.75-.35.19 0 .38 0 .54.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.49-.14.14-.29.29-.12.57.16.28.73 1.2 1.57 1.95 1.08.96 1.99 1.26 2.27 1.4.28.14.44.12.61-.07.16-.19.7-.81.88-1.09.19-.28.38-.23.63-.14.26.09 1.65.78 1.93.92.28.14.47.21.54.33.07.12.07.68-.17 1.35Z"/>
    </svg>
  );
}

function MemberCard({ member, accent }: { member: CommitteeMember; accent?: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
      style={{ borderLeftColor: accent ?? '#475569', borderLeftWidth: 3 }}>
      <p className="text-slate-900 dark:text-white font-semibold text-sm leading-tight">{member.name}</p>
      <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{member.role}</p>
      {member.apartment && <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">Apt {member.apartment}</p>}
      {member.phone && (
        <div className="flex items-center gap-2 mt-1">
          <a
            href={`tel:+${withCountryCode(member.phone)}`}
            className="text-slate-500 dark:text-slate-400 text-xs hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors"
          >
            {member.phone}
          </a>
          {member.whatsapp_optin && (
            <a
              href={`https://wa.me/${withCountryCode(member.phone)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Message ${member.name} on WhatsApp`}
              className="text-emerald-600 dark:text-emerald-400 hover:opacity-70 transition-opacity flex-shrink-0"
            >
              <WhatsAppIcon className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default async function CommitteePage() {
  const term = await getCurrentCommitteeTerm();
  const members = term ? await getCommitteeMembers(term) : [];

  const officeBearers = members
    .filter((m) => OFFICE_BEARER_ROLE_SET.has(m.role))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));

  const gcChairs = members
    .filter((m) => m.role === 'GC Chair')
    .sort((a, b) => a.name.localeCompare(b.name));

  const gcMembersByTower: Record<TowerName, CommitteeMember[]> = {
    Venus: [], Mercury: [], Neptune: [], Jupiter: [],
  };
  for (const m of members.filter((m) => m.role === 'GC Member')) {
    if (m.tower && m.tower in gcMembersByTower) {
      gcMembersByTower[m.tower as TowerName].push(m);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-1 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-700 dark:text-slate-300">Management Committee</h1>
          {term && <p className="text-slate-500 dark:text-slate-400 text-xs">Term {term}</p>}
        </div>
        <Link href="/committee/admin"
          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors">
          Admin
        </Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-8">
        {officeBearers.length > 0 && (
          <section>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Office Bearers</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {officeBearers.map((m) => (
                <MemberCard key={m.id} member={m} accent={m.tower ? TOWER_COLORS[m.tower as TowerName] : '#6366f1'} />
              ))}
            </div>
          </section>
        )}

        {gcChairs.length > 0 && (
          <section>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">GC Chairs</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {gcChairs.map((m) => (
                <MemberCard key={m.id} member={m} accent={m.tower ? TOWER_COLORS[m.tower as TowerName] : '#6366f1'} />
              ))}
            </div>
          </section>
        )}

        {TOWERS.some((t) => gcMembersByTower[t].length > 0) && (
          <section>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">GC Members</p>
            <div className="space-y-5">
              {TOWERS.map((tower) => {
                const towerMembers = gcMembersByTower[tower];
                if (towerMembers.length === 0) return null;
                return (
                  <div key={tower}>
                    <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${TOWER_TEXT_CLASSES[tower]}`}>{tower}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {towerMembers.map((m) => (
                        <MemberCard key={m.id} member={m} accent={TOWER_COLORS[tower]} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {members.length === 0 && (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400">
            <p className="text-lg">No committee data found.</p>
            <p className="text-sm mt-1">
              <Link href="/committee/admin" className="text-blue-600 dark:text-blue-400 hover:underline">Add members in the admin page</Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
