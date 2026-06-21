import Link from 'next/link';
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

function MemberCard({ member, accent }: { member: CommitteeMember; accent?: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
      style={{ borderLeftColor: accent ?? '#475569', borderLeftWidth: 3 }}>
      <p className="text-slate-900 dark:text-white font-semibold text-sm leading-tight">{member.name}</p>
      <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{member.role}</p>
      {member.apartment && <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Apt {member.apartment}</p>}
      {member.phone && <p className="text-slate-400 dark:text-slate-500 text-xs">{member.phone}</p>}
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
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <Link href="/" className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-sm">
              ← Dashboard
            </Link>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight mt-0.5">Management Committee</h1>
            {term && <p className="text-slate-500 dark:text-slate-400 text-xs">Term {term}</p>}
          </div>
          <Link href="/committee/admin"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors">
            Admin
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-8">
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
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
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
