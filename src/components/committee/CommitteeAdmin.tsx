'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar, { IconAlerts } from '@/components/Navbar';
import { supabase } from '@/lib/supabase';
import { TOWER_COLORS, TOWER_TEXT_CLASSES } from '@/lib/utils';
import type { CommitteeMember, CommitteeRole, TowerName } from '@/types';
import { ALL_COMMITTEE_ROLES, OFFICE_BEARER_ROLES } from '@/types';

const ROLE_ORDER: Record<CommitteeRole, number> = {
  'President': 0, 'Vice President': 1, 'Secretary': 2, 'Joint Secretary': 3,
  'Treasurer': 4, 'Joint Treasurer': 5, 'Technical Expert': 6, 'Financial Expert': 7,
  'GC Chair': 8, 'GC Member': 9,
};

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

function validatePhone(raw: string): string | null {
  const digits = raw.replace(/[\s+\-()]/g, '').replace(/^91/, '');
  if (!digits) return null;
  if (!INDIAN_MOBILE_RE.test(digits)) return 'Enter a valid 10-digit Indian mobile number (starts with 6–9)';
  return null;
}

interface FormData {
  name: string;
  role: CommitteeRole;
  tower: TowerName | '';
  apartment: string;
  phone: string;
  email: string;
  whatsapp_optin: boolean;
}

const EMPTY_FORM: FormData = {
  name: '', role: 'GC Member', tower: '',
  apartment: '', phone: '', email: '', whatsapp_optin: true,
};

function memberToForm(m: CommitteeMember): FormData {
  return {
    name: m.name, role: m.role,
    tower: m.tower ?? '', apartment: m.apartment ?? '',
    phone: m.phone ?? '', email: m.email ?? '',
    whatsapp_optin: m.whatsapp_optin,
  };
}

export default function CommitteeAdmin() {
  const [terms, setTerms] = useState<string[]>([]);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [members, setMembers] = useState<CommitteeMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; member?: CommitteeMember } | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [saving, setSaving] = useState(false);

  const [newTermOpen, setNewTermOpen] = useState(false);
  const [newTermLabel, setNewTermLabel] = useState('');
  const [cloneIds, setCloneIds] = useState<Set<string>>(new Set());
  const [newTermSaving, setNewTermSaving] = useState(false);

  const fetchTerms = useCallback(async () => {
    const { data } = await supabase
      .from('committee_members')
      .select('term')
      .order('term', { ascending: false });
    if (!data) return;
    const unique = [...new Set(data.map((d) => d.term as string))];
    setTerms(unique);
    if (!selectedTerm && unique.length > 0) setSelectedTerm(unique[0]);
  }, [selectedTerm]);

  const fetchMembers = useCallback(async (term: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('committee_members')
      .select('*')
      .eq('term', term)
      .order('name');
    setMembers((data ?? []) as CommitteeMember[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTerms(); }, [fetchTerms]);
  useEffect(() => { if (selectedTerm) fetchMembers(selectedTerm); }, [selectedTerm, fetchMembers]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModal({ mode: 'add' });
  }

  function openEdit(m: CommitteeMember) {
    setForm(memberToForm(m));
    setFormErrors({});
    setModal({ mode: 'edit', member: m });
  }

  function closeModal() { setModal(null); }

  function validateForm(): boolean {
    const errors: Partial<Record<keyof FormData, string>> = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    if (form.phone) {
      const err = validatePhone(form.phone);
      if (err) errors.phone = err;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email address';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!validateForm()) return;
    setSaving(true);
    const payload = {
      term: selectedTerm,
      name: form.name.trim(),
      role: form.role,
      tower: form.tower || null,
      apartment: form.apartment.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      whatsapp_optin: form.whatsapp_optin,
      updated_at: new Date().toISOString(),
    };

    if (modal?.mode === 'add') {
      await supabase.from('committee_members').insert(payload);
    } else if (modal?.member) {
      await supabase
        .from('committee_members')
        .update(payload)
        .eq('id', modal.member.id);
    }
    setSaving(false);
    closeModal();
    fetchMembers(selectedTerm);
  }

  async function handleDeactivate(m: CommitteeMember) {
    if (!confirm(`Deactivate ${m.name}? They will no longer appear on the committee page.`)) return;
    await supabase
      .from('committee_members')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', m.id);
    fetchMembers(selectedTerm);
  }

  function openNewTerm() {
    const activeMembers = members.filter((m) => m.active);
    setCloneIds(new Set(activeMembers.map((m) => m.id)));
    setNewTermLabel('');
    setNewTermOpen(true);
  }

  async function handleNewTerm() {
    if (!newTermLabel.trim()) return;
    const trimmed = newTermLabel.trim();
    if (terms.includes(trimmed)) {
      alert(`Term "${trimmed}" already exists.`);
      return;
    }
    setNewTermSaving(true);

    // Archive current term
    await supabase
      .from('committee_members')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('term', selectedTerm)
      .eq('active', true);

    // Clone selected members
    const toClone = members.filter((m) => m.active && cloneIds.has(m.id));
    if (toClone.length > 0) {
      await supabase.from('committee_members').insert(
        toClone.map((m) => ({
          term: trimmed,
          name: m.name, role: m.role,
          tower: m.tower, apartment: m.apartment,
          phone: m.phone, email: m.email,
          whatsapp_optin: m.whatsapp_optin,
          active: true,
        }))
      );
    }

    setNewTermSaving(false);
    setNewTermOpen(false);
    await fetchTerms();
    setSelectedTerm(trimmed);
  }

  const isCurrentTerm = terms.length > 0 && selectedTerm === terms[0];
  const activeMembers = members.filter((m) => m.active);
  const inactiveMembers = members.filter((m) => !m.active);

  // Group active members by role category
  const officeBearers = activeMembers
    .filter((m) => (OFFICE_BEARER_ROLES as CommitteeRole[]).includes(m.role))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));
  const gcChairs = activeMembers.filter((m) => m.role === 'GC Chair').sort((a, b) => a.name.localeCompare(b.name));
  const gcMembers = activeMembers.filter((m) => m.role === 'GC Member').sort((a, b) => a.name.localeCompare(b.name));

  function MemberRow({ m }: { m: CommitteeMember }) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0">
        <div className="flex items-center gap-3 min-w-0">
          {m.tower && (
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: TOWER_COLORS[m.tower as TowerName] }}
            />
          )}
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{m.name}</p>
            <p className="text-slate-400 text-xs">
              {m.role}{m.apartment ? ` · Apt ${m.apartment}` : ''}{m.phone ? ` · ${m.phone}` : ''}
            </p>
          </div>
        </div>
        {isCurrentTerm && (
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <button
              onClick={() => openEdit(m)}
              className="text-slate-400 hover:text-white text-xs border border-slate-700 hover:border-slate-500 px-2 py-1 rounded transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => handleDeactivate(m)}
              className="text-slate-400 hover:text-red-400 text-xs border border-slate-700 hover:border-red-800 px-2 py-1 rounded transition-colors"
            >
              Off
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-1 flex items-center justify-between">
        <div>
          <Link href="/committee" className="text-slate-500 hover:text-white transition-colors text-xs">
            ← Committee
          </Link>
          <h1 className="text-base font-semibold text-slate-300 mt-0.5">Admin</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* P2-1: Alerts was demoted out of the public nav since it's an
              ops-internal email log, not resident-facing. It's still one
              click away for committee members once they're past the PIN
              gate on this page. */}
          <Link
            href="/alerts"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            <IconAlerts className="w-4 h-4" />
            <span className="hidden sm:inline">Alert Log</span>
          </Link>
          {terms.length > 0 && (
            <select
              value={selectedTerm}
              onChange={(e) => setSelectedTerm(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {terms.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          {isCurrentTerm && (
            <button
              onClick={openAdd}
              className="bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-all"
            >
              + Add
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-5">

        {isCurrentTerm && (
          <div className="flex justify-between items-center">
            <p className="text-slate-400 text-sm">{activeMembers.length} active members</p>
            <button
              onClick={openNewTerm}
              className="text-slate-300 hover:text-white text-sm border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              Start New Term
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <span className="w-8 h-8 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {officeBearers.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  Office Bearers
                </p>
                {officeBearers.map((m) => <MemberRow key={m.id} m={m} />)}
              </section>
            )}

            {gcChairs.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  GC Chairs
                </p>
                {gcChairs.map((m) => <MemberRow key={m.id} m={m} />)}
              </section>
            )}

            {gcMembers.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  GC Members
                </p>
                {gcMembers.map((m) => <MemberRow key={m.id} m={m} />)}
              </section>
            )}

            {inactiveMembers.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 opacity-50">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  Inactive ({inactiveMembers.length})
                </p>
                {inactiveMembers.map((m) => (
                  <div key={m.id} className="py-2 border-b border-slate-800 last:border-0">
                    <p className="text-slate-400 text-sm">{m.name} · {m.role}</p>
                  </div>
                ))}
              </section>
            )}

            {activeMembers.length === 0 && !loading && (
              <div className="text-center py-16 text-slate-500">
                <p>No members for term {selectedTerm}.</p>
                {isCurrentTerm && (
                  <button onClick={openAdd} className="mt-3 text-blue-400 hover:text-blue-300 text-sm">
                    Add first member
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Add / Edit modal ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800">
              <h2 className="text-white font-semibold">
                {modal.mode === 'add' ? 'Add Member' : 'Edit Member'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <Field label="Name *" error={formErrors.name}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls(!!formErrors.name)}
                  placeholder="Full name"
                />
              </Field>

              <Field label="Role *">
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as CommitteeRole })}
                  className={inputCls(false)}
                >
                  {ALL_COMMITTEE_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>

              <Field label="Tower">
                <select
                  value={form.tower}
                  onChange={(e) => setForm({ ...form, tower: e.target.value as TowerName | '' })}
                  className={inputCls(false)}
                >
                  <option value="">— None (office bearer without tower) —</option>
                  {TOWERS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Apartment">
                <input
                  type="text"
                  value={form.apartment}
                  onChange={(e) => setForm({ ...form, apartment: e.target.value })}
                  className={inputCls(false)}
                  placeholder="e.g. 10B"
                />
              </Field>

              <Field label="Phone" error={formErrors.phone}>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={inputCls(!!formErrors.phone)}
                  placeholder="+91 98765 43210"
                />
              </Field>

              <Field label="Email" error={formErrors.email}>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls(!!formErrors.email)}
                  placeholder="name@example.com"
                />
              </Field>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.whatsapp_optin}
                  onChange={(e) => setForm({ ...form, whatsapp_optin: e.target.checked })}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-slate-300 text-sm">WhatsApp opt-in</span>
              </label>
            </div>

            <div className="flex gap-3 px-5 pb-5 pt-2">
              <button
                onClick={closeModal}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-slate-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Term modal ── */}
      {newTermOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800">
              <h2 className="text-white font-semibold">Start New Term</h2>
              <button onClick={() => setNewTermOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <Field label="New term label (e.g. 2027-28)">
                <input
                  type="text"
                  value={newTermLabel}
                  onChange={(e) => setNewTermLabel(e.target.value)}
                  className={inputCls(false)}
                  placeholder="2027-28"
                />
              </Field>

              <div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                  Carry forward to new term
                </p>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {activeMembers.map((m) => (
                    <label key={m.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cloneIds.has(m.id)}
                        onChange={(e) => {
                          const next = new Set(cloneIds);
                          if (e.target.checked) next.add(m.id); else next.delete(m.id);
                          setCloneIds(next);
                        }}
                        className="w-4 h-4 rounded accent-blue-600 flex-shrink-0"
                      />
                      <span className="text-slate-200 text-sm">{m.name}</span>
                      <span className="text-slate-500 text-xs ml-auto">{m.role}</span>
                    </label>
                  ))}
                </div>
                <p className="text-slate-500 text-xs mt-2">
                  {cloneIds.size} of {activeMembers.length} selected · current term will be archived
                </p>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5 pt-2">
              <button
                onClick={() => setNewTermOpen(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNewTerm}
                disabled={newTermSaving || !newTermLabel.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-slate-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                {newTermSaving ? 'Creating…' : 'Create New Term'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-slate-300 text-xs font-medium mb-1">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return `w-full bg-slate-800 border ${hasError ? 'border-red-600' : 'border-slate-700'} text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-slate-500`;
}
