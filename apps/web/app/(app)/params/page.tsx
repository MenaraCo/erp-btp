'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* ─────────── hook token ─────────── */
function useApi() {
  const { token } = useAuth();
  return useCallback(<T = unknown>(path: string, opts: Parameters<typeof apiFetch>[1] = {}) =>
    apiFetch<T>(path, { ...opts, token }), [token]);
}

/* ─────────── hook feedback sauvegarde ─────────── */
function useSavedFeedback(delayMs = 3000) {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nettoyage si le composant démonte avant la fin du délai
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const flash = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaved(true);
    timerRef.current = setTimeout(() => setSaved(false), delayMs);
  }, [delayMs]);

  return { saved, flash };
}

/* ─────────── hook sélection groupée ─────────── */
function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = (ids: string[]) => setSelectedIds(
    selectedIds.size === ids.length ? new Set() : new Set(ids),
  );
  const clear = () => setSelectedIds(new Set());
  return { selectedIds, toggle, toggleAll, clear };
}

/* ─────────── helpers ─────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', ...style }}>{children}</div>;
}

/* ─────────── types ─────────── */

interface Unit { id: string; abrev: string; label: string; sort_order: number }
interface Lot { id: string; code: string; label: string }
interface Famille { id: string; code: string; label: string; lot_id: string; nature: string; lot_code?: string; lot_label?: string }
interface Code { id: string; code: string; label: string; famille_id: string; nature: string; famille_code?: string; famille_label?: string }

const NAT_OPTS = [
  { v: 'material', l: 'Matériaux' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];
const natLabel = (v: string) => NAT_OPTS.find((n) => n.v === v)?.l ?? v;
interface Company { id: string; code: string; name: string; address?: string; postal_code?: string; city?: string; phone?: string; email?: string; legal_form?: string; siret?: string; vat_intra?: string; rcs?: string; capital?: string }
interface Preferences { id: string; taux_fg_default: string; taux_ben_default: string; devis_prefix: string; devis_separator: string; couleur_principale: string; couleur_accent: string; taux_tva: number[]; default_tab: string; nb_decimales: number }

/* ─────────── tabs ─────────── */

const TABS = ['Entreprise', 'Familles', 'Codes analytiques', 'Lots', 'Unités', 'Préférences'] as const;
type Tab = typeof TABS[number];

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export default function ParamsPage() {
  const [tab, setTab] = useState<Tab>('Entreprise');
  const { token } = useAuth();

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      <h1 style={{ margin: '0 0 4px' }}>Paramètres</h1>
      <p className="muted" style={{ margin: '0 0 20px' }}>Configuration de votre entreprise et référentiels</p>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: tab === t ? 'var(--primary)' : 'var(--muted)',
              borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {token && tab === 'Entreprise' && <TabEntreprise token={token} />}
      {token && tab === 'Familles' && <TabFamilles token={token} />}
      {token && tab === 'Codes analytiques' && <TabCodes token={token} />}
      {token && tab === 'Lots' && <TabLots token={token} />}
      {token && tab === 'Unités' && <TabUnites token={token} />}
      {token && tab === 'Préférences' && <TabPreferences token={token} />}
      {!token && <p className="muted">Chargement…</p>}
    </div>
  );
}

/* ─────────── Entreprise ─────────── */

function TabEntreprise({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { saved, flash } = useSavedFeedback();
  const { data: company } = useQuery<Company>({
    queryKey: ['params-company'],
    queryFn: () => api<Company>('/params/company'),
    enabled: Boolean(token),
  });
  const [form, setForm] = useState<Partial<Company>>({});
  const f = (k: keyof Company) => (form[k] as string) ?? (company as any)?.[k] ?? '';

  const save = useMutation({
    mutationFn: () => api(`/params/company/${company!.id}`, { method: 'PATCH', body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-company'] }); setForm({}); flash(); },
  });

  if (!company) return <p className="muted">Chargement…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card title="Votre entreprise">

        <Row>
          <Field label="Nom de l'entreprise *"><input className="input" style={{ width: 280 }} value={f('name')} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Forme juridique"><input className="input" style={{ width: 120 }} value={f('legal_form')} onChange={(e) => setForm({ ...form, legal_form: e.target.value })} /></Field>
        </Row>
        <Field label="Adresse"><input className="input" style={{ width: '100%' }} value={f('address')} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Row>
          <Field label="Code postal"><input className="input" style={{ width: 100 }} value={f('postal_code')} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></Field>
          <Field label="Ville"><input className="input" style={{ width: 200 }} value={f('city')} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        </Row>
        <Row>
          <Field label="Téléphone"><input className="input" style={{ width: 140 }} value={f('phone')} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" style={{ width: 220 }} value={f('email')} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </Row>
        <Row>
          <Field label="SIRET"><input className="input" style={{ width: 160 }} value={f('siret')} onChange={(e) => setForm({ ...form, siret: e.target.value })} /></Field>
          <Field label="N° TVA intracommunautaire"><input className="input" style={{ width: 150 }} value={f('vat_intra')} onChange={(e) => setForm({ ...form, vat_intra: e.target.value })} /></Field>
          <Field label="RCS"><input className="input" style={{ width: 120 }} value={f('rcs')} onChange={(e) => setForm({ ...form, rcs: e.target.value })} /></Field>
        </Row>
        <Field label="Capital social"><input className="input" style={{ width: 140 }} value={f('capital')} onChange={(e) => setForm({ ...form, capital: e.target.value })} /></Field>
      </Card>
      <SaveButton onSave={() => save.mutate()} isPending={save.isPending} saved={saved} />
    </div>
  );
}

/* ─────────── Lots ─────────── */

function TabLots({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['params-lots'],
    queryFn: () => api<Lot[]>('/params/lots'),
    enabled: Boolean(token),
  });
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: string; code: string; label: string } | null>(null);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();

  const inv = () => { qc.invalidateQueries({ queryKey: ['params-lots'] }); qc.invalidateQueries({ queryKey: ['params-familles'] }); };

  const create = useMutation({
    mutationFn: () => api('/params/lots', { method: 'POST', body: { code: newCode, label: newLabel } }),
    onSuccess: () => { inv(); setNewCode(''); setNewLabel(''); },
  });
  const update = useMutation({
    mutationFn: (e: typeof editing) => api(`/params/lots/${e!.id}`, { method: 'PATCH', body: { code: e!.code, label: e!.label } }),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/lots/${id}`, { method: 'DELETE' }),
    onSuccess: inv,
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/lots/${id}`, { method: 'DELETE' }))),
    onSuccess: () => { inv(); clear(); },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Ajouter un lot">
        <Row>
          <Field label="Code"><input className="input" style={{ width: 100 }} placeholder="EX: GO" value={newCode} onChange={(e) => setNewCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create.mutate()} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 340 }} placeholder="Ex: Gros œuvre" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create.mutate()} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()} disabled={!newCode || !newLabel}>+ Ajouter</button>
        </Row>
      </Card>
      <Card title={`Lots prédéfinis${lots.length > 0 ? ` (${lots.length})` : ''}`}>
        {selectedIds.size > 0 && (
          <BulkBar count={selectedIds.size} isPending={bulkDelete.isPending}
            onDelete={() => { if (confirm(`Supprimer ${selectedIds.size} lot(s) ?`)) bulkDelete.mutate(); }} />
        )}
        <RefTable
          rows={lots.map((l) => [l.code, l.label])}
          headers={['Code', 'Désignation']}
          ids={lots.map((l) => l.id)}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={() => toggleAll(lots.map((l) => l.id))}
          onEdit={(i) => setEditing({ id: lots[i].id, code: lots[i].code, label: lots[i].label })}
          onDelete={(i) => { if (confirm('Supprimer ce lot ?')) del.mutate(lots[i].id); }}
        />
      </Card>
      {editing && (
        <Modal title="Modifier le lot" onClose={() => setEditing(null)}>
          <Field label="Code"><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 300 }} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <Row style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn" onClick={() => setEditing(null)}>Annuler</button>
            <button className="btn" onClick={() => update.mutate(editing)}>Modifier</button>
          </Row>
        </Modal>
      )}
    </div>
  );
}

/* ─────────── Familles ─────────── */

function TabFamilles({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: familles = [] } = useQuery<Famille[]>({
    queryKey: ['params-familles'],
    queryFn: () => api<Famille[]>('/params/familles'),
    enabled: Boolean(token),
  });
  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ['params-lots'],
    queryFn: () => api<Lot[]>('/params/lots'),
    enabled: Boolean(token),
  });
  const [nf, setNf] = useState({ lotId: '', code: '', label: '', nature: 'material' });
  const [editing, setEditing] = useState<{ id: string; lotId: string; code: string; label: string; nature: string } | null>(null);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();

  const inv = () => qc.invalidateQueries({ queryKey: ['params-familles'] });

  const create = useMutation({
    mutationFn: () => api('/params/familles', { method: 'POST', body: { lotId: nf.lotId, code: nf.code, label: nf.label, nature: nf.nature } }),
    onSuccess: () => { inv(); setNf({ lotId: '', code: '', label: '', nature: 'material' }); },
  });
  const update = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => api(`/params/familles/${e.id}`, { method: 'PATCH', body: { lotId: e.lotId, code: e.code, label: e.label, nature: e.nature } }),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/familles/${id}`, { method: 'DELETE' }),
    onSuccess: inv,
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/familles/${id}`, { method: 'DELETE' }))),
    onSuccess: () => { inv(); clear(); },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Ajouter une famille">
        <Row>
          <Field label="Lot parent">
            <select className="input" style={{ width: 200 }} value={nf.lotId} onChange={(e) => setNf({ ...nf, lotId: e.target.value })}>
              <option value="">— choisir —</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label}</option>)}
            </select>
          </Field>
          <Field label="Nature">
            <select className="input" style={{ width: 150 }} value={nf.nature} onChange={(e) => setNf({ ...nf, nature: e.target.value })}>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 120 }} placeholder="Ex: P_COL" value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 260 }} placeholder="Ex: Colles" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()} disabled={!nf.lotId || !nf.code || !nf.label}>+ Ajouter</button>
        </Row>
      </Card>
      <Card title={`Familles de ressources${familles.length > 0 ? ` (${familles.length})` : ''}`}>
        {selectedIds.size > 0 && (
          <BulkBar count={selectedIds.size} isPending={bulkDelete.isPending}
            onDelete={() => { if (confirm(`Supprimer ${selectedIds.size} famille(s) ?`)) bulkDelete.mutate(); }} />
        )}
        <RefTable
          rows={familles.map((f) => [f.code, f.label, f.lot_code ? `${f.lot_code} — ${f.lot_label}` : '—', natLabel(f.nature)])}
          headers={['Code', 'Désignation', 'Lot parent', 'Nature']}
          ids={familles.map((f) => f.id)}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={() => toggleAll(familles.map((f) => f.id))}
          onEdit={(i) => setEditing({ id: familles[i].id, lotId: familles[i].lot_id, code: familles[i].code, label: familles[i].label, nature: familles[i].nature })}
          onDelete={(i) => { if (confirm('Supprimer cette famille ?')) del.mutate(familles[i].id); }}
        />
      </Card>
      {editing && (
        <Modal title="Modifier la famille" onClose={() => setEditing(null)}>
          <Field label="Lot parent">
            <select className="input" value={editing.lotId} onChange={(e) => setEditing({ ...editing, lotId: e.target.value })}>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label}</option>)}
            </select>
          </Field>
          <Field label="Nature">
            <select className="input" value={editing.nature} onChange={(e) => setEditing({ ...editing, nature: e.target.value })}>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 300 }} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <Row style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn" onClick={() => setEditing(null)}>Annuler</button>
            <button className="btn" onClick={() => update.mutate(editing)}>Modifier</button>
          </Row>
        </Modal>
      )}
    </div>
  );
}

/* ─────────── Codes analytiques ─────────── */

function TabCodes({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: codes = [] } = useQuery<Code[]>({
    queryKey: ['params-codes'],
    queryFn: () => api<Code[]>('/params/codes'),
    enabled: Boolean(token),
  });
  const { data: familles = [] } = useQuery<Famille[]>({
    queryKey: ['params-familles'],
    queryFn: () => api<Famille[]>('/params/familles'),
    enabled: Boolean(token),
  });
  const [nf, setNf] = useState({ familleId: '', code: '', label: '', nature: 'material' });
  const [editing, setEditing] = useState<{ id: string; familleId: string; code: string; label: string; nature: string } | null>(null);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();

  const inv = () => qc.invalidateQueries({ queryKey: ['params-codes'] });

  // Quand on choisit une famille, pré-remplir la nature avec celle de la famille
  const onPickFamille = (familleId: string, setter: (n: string) => void) => {
    const fa = familles.find((x) => x.id === familleId);
    if (fa) setter(fa.nature);
  };

  const create = useMutation({
    mutationFn: () => api('/params/codes', { method: 'POST', body: { familleId: nf.familleId, code: nf.code, label: nf.label, nature: nf.nature } }),
    onSuccess: () => { inv(); setNf({ familleId: '', code: '', label: '', nature: 'material' }); },
  });
  const update = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => api(`/params/codes/${e.id}`, { method: 'PATCH', body: { familleId: e.familleId, code: e.code, label: e.label, nature: e.nature } }),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/codes/${id}`, { method: 'DELETE' }),
    onSuccess: inv,
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/codes/${id}`, { method: 'DELETE' }))),
    onSuccess: () => { inv(); clear(); },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Ajouter un code analytique">
        <Row>
          <Field label="Famille">
            <select className="input" style={{ width: 200 }} value={nf.familleId}
              onChange={(e) => { setNf({ ...nf, familleId: e.target.value }); onPickFamille(e.target.value, (n) => setNf((s) => ({ ...s, familleId: e.target.value, nature: n }))); }}>
              <option value="">— choisir —</option>
              {familles.map((fa) => <option key={fa.id} value={fa.id}>{fa.code} — {fa.label}</option>)}
            </select>
          </Field>
          <Field label="Nature">
            <select className="input" style={{ width: 150 }} value={nf.nature} onChange={(e) => setNf({ ...nf, nature: e.target.value })}>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 110 }} placeholder="Ex: 280" value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 240 }} placeholder="Ex: Colle carrelage" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()} disabled={!nf.familleId || !nf.code || !nf.label}>+ Ajouter</button>
        </Row>
      </Card>
      <Card title={`Codes analytiques${codes.length > 0 ? ` (${codes.length})` : ''}`}>
        {selectedIds.size > 0 && (
          <BulkBar count={selectedIds.size} isPending={bulkDelete.isPending}
            onDelete={() => { if (confirm(`Supprimer ${selectedIds.size} code(s) analytique(s) ?`)) bulkDelete.mutate(); }} />
        )}
        <RefTable
          rows={codes.map((c) => [c.code, c.label, c.famille_code ? `${c.famille_code} — ${c.famille_label}` : '—', natLabel(c.nature)])}
          headers={['Code', 'Désignation', 'Famille', 'Nature']}
          ids={codes.map((c) => c.id)}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={() => toggleAll(codes.map((c) => c.id))}
          onEdit={(i) => setEditing({ id: codes[i].id, familleId: codes[i].famille_id, code: codes[i].code, label: codes[i].label, nature: codes[i].nature })}
          onDelete={(i) => { if (confirm('Supprimer ce code analytique ?')) del.mutate(codes[i].id); }}
        />
      </Card>
      {editing && (
        <Modal title="Modifier le code analytique" onClose={() => setEditing(null)}>
          <Field label="Famille">
            <select className="input" value={editing.familleId}
              onChange={(e) => { const id = e.target.value; const fa = familles.find((x) => x.id === id); setEditing({ ...editing, familleId: id, nature: fa ? fa.nature : editing.nature }); }}>
              {familles.map((fa) => <option key={fa.id} value={fa.id}>{fa.code} — {fa.label}</option>)}
            </select>
          </Field>
          <Field label="Nature">
            <select className="input" value={editing.nature} onChange={(e) => setEditing({ ...editing, nature: e.target.value })}>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 300 }} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <Row style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn" onClick={() => setEditing(null)}>Annuler</button>
            <button className="btn" onClick={() => update.mutate(editing)}>Modifier</button>
          </Row>
        </Modal>
      )}
    </div>
  );
}

/* ─────────── Unités ─────────── */

function TabUnites({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ['params-units'],
    queryFn: () => api<Unit[]>('/params/units'),
    enabled: Boolean(token),
  });
  const [form, setForm] = useState({ abrev: '', label: '' });
  const [editing, setEditing] = useState<Unit | null>(null);

  const create = useMutation({
    mutationFn: () => api('/params/units', { method: 'POST', body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-units'] }); setForm({ abrev: '', label: '' }); },
  });
  const update = useMutation({
    mutationFn: (u: Unit) => api(`/params/units/${u.id}`, { method: 'PATCH', body: { abrev: u.abrev, label: u.label } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-units'] }); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/units/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['params-units'] }),
  });
  const moveUp = useMutation({
    mutationFn: (idx: number) => {
      const newOrder = [...units];
      [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
      return api('/params/units/reorder', { method: 'PUT', body: { ids: newOrder.map((u) => u.id) } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['params-units'] }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Unités de mesure${units.length > 0 ? ` (${units.length})` : ''}`}>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 11 }}>
          Ces unités sont proposées dans tous les sélecteurs (lignes de devis, ressources, ouvrages…)
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Abréviation</th>
              <th>Désignation</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={u.id}>
                <td>
                  <button className="btn-ghost btn" style={{ padding: '0 4px' }}
                    onClick={() => i > 0 && moveUp.mutate(i)} disabled={i === 0}>↑</button>
                </td>
                <td><strong>{u.abrev}</strong></td>
                <td>{u.label}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-ghost btn" onClick={() => setEditing(u)}>✎</button>
                  <button className="btn-danger btn" onClick={() => { if (confirm('Supprimer ?')) del.mutate(u.id); }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row style={{ marginTop: 12 }}>
          <Field label="Abrév."><input className="input" style={{ width: 80 }} placeholder="M2" value={form.abrev} onChange={(e) => setForm({ ...form, abrev: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 260 }} placeholder="Mètre carré" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()}>+ Ajouter</button>
        </Row>
      </Card>
      {editing && (
        <Modal title="Modifier l'unité" onClose={() => setEditing(null)}>
          <Field label="Abréviation"><input className="input" style={{ width: 100 }} value={editing.abrev} onChange={(e) => setEditing({ ...editing, abrev: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 300 }} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <Row style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn" onClick={() => setEditing(null)}>Annuler</button>
            <button className="btn" onClick={() => update.mutate(editing!)}>Modifier</button>
          </Row>
        </Modal>
      )}
    </div>
  );
}

/* ─────────── Préférences ─────────── */

/* Helper : affiche un nombre sans décimales inutiles (25 au lieu de 25.00, 25.5 ok) */
function fmtNum(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '';
  const n = Number(val);
  if (isNaN(n)) return String(val);
  // Supprime les zéros décimaux inutiles
  return n % 1 === 0 ? String(n) : String(n);
}

const DEFAULT_TABS = [
  { v: 'etude', l: 'Étude de prix (Débours)' },
  { v: 'coefficients', l: 'Coefficients & Frais annexes' },
  { v: 'client', l: 'Devis client (Prix de vente)' },
  { v: 'pdf', l: 'Aperçu PDF' },
];

function TabPreferences({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { saved, flash } = useSavedFeedback();
  const { data: prefs } = useQuery<Preferences>({
    queryKey: ['params-preferences'],
    queryFn: () => api<Preferences>('/params/preferences'),
    enabled: Boolean(token),
  });

  // Champs texte simples (FG, bénéfice, prefix, séparateur, couleur)
  const [form, setForm] = useState<Record<string, string>>({});
  // TVA : tableau local
  const [tvaTaux, setTvaTaux] = useState<number[] | null>(null);
  const [tvaInput, setTvaInput] = useState('');
  // Onglet par défaut
  const [defaultTab, setDefaultTab] = useState<string | null>(null);
  // Nb décimales
  const [nbDec, setNbDec] = useState<number | null>(null);

  // Initialise les états locaux depuis prefs quand chargé (useEffect pour éviter setState en render)
  useEffect(() => {
    if (prefs) {
      setTvaTaux(prefs.taux_tva ?? [0, 5.5, 10, 20]);
      setDefaultTab(prefs.default_tab ?? 'etude');
      setNbDec(prefs.nb_decimales ?? 2);
    }
  }, [prefs]);

  const currentTva = tvaTaux ?? prefs?.taux_tva ?? [0, 5.5, 10, 20];
  const currentTab = defaultTab ?? prefs?.default_tab ?? 'etude';
  const currentNbDec = nbDec ?? prefs?.nb_decimales ?? 2;

  // Valeur d'un champ texte : form local ou prefs DB (sans .00 inutiles)
  const f = (k: string) => form[k] ?? fmtNum((prefs as any)?.[k]);

  const fg = Number(f('taux_fg_default')) || 0;
  const ben = Number(f('taux_ben_default')) || 0;
  const coeff = ((1 + fg / 100) * (1 + ben / 100)).toFixed(3);

  const addTva = () => {
    const v = parseFloat(tvaInput.replace(',', '.'));
    if (!isNaN(v) && !currentTva.includes(v)) {
      setTvaTaux([...currentTva, v].sort((a, b) => a - b));
      setTvaInput('');
    }
  };

  const removeTva = (t: number) => setTvaTaux(currentTva.filter((x) => x !== t));

  const save = useMutation({
    mutationFn: () => api('/params/preferences', {
      method: 'PATCH',
      body: {
        tauxFgDefault: f('taux_fg_default') !== '' ? Number(f('taux_fg_default')) : undefined,
        tauxBenDefault: f('taux_ben_default') !== '' ? Number(f('taux_ben_default')) : undefined,
        devisPrefix: f('devis_prefix') || null,
        devisSeparator: f('devis_separator') || null,
        couleurPrincipale: f('couleur_principale') || null,
        couleurAccent: f('couleur_accent') || null,
        tauxTva: currentTva,
        defaultTab: currentTab,
        nbDecimales: currentNbDec,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['params-preferences'] });
      qc.invalidateQueries({ queryKey: ['app-preferences'] }); // propagé au PrefsProvider
      setForm({});
      flash();
    },
    onError: (err: unknown) => {
      alert('Erreur lors de l\'enregistrement : ' + (err instanceof Error ? err.message : String(err)));
    },
  });

  if (!prefs) return <p className="muted">Chargement…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Taux de TVA ── */}
      <Card title="Taux de TVA disponibles">
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 11 }}>
          Ces taux seront proposés dans les sélecteurs TVA de chaque ligne de devis. TVA 0% = autoliquidation.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {currentTva.map((t) => (
            <span key={t} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: t === 0 ? '#fff8e1' : 'var(--bg-alt)',
              border: `1px solid ${t === 0 ? '#f0c040' : 'var(--border)'}`,
              color: t === 0 ? '#8a6000' : 'var(--text)',
            }}>
              {t === 0 ? `Autoliquidée (0%)` : `${fmtNum(t)}%`}
              <button onClick={() => removeTva(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <Row>
          <input className="input" style={{ width: 100 }} placeholder="Ex: 0 ou 8" value={tvaInput}
            onChange={(e) => setTvaInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTva()} />
          <button className="btn-secondary btn" onClick={addTva}>+ Ajouter</button>
        </Row>
      </Card>

      {/* ── Taux par défaut FG / Bénéfice ── */}
      <Card title="Taux par défaut">
        <Row>
          <Field label="% Frais généraux">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="input" style={{ width: 80, background: '#fffbf0' }}
                value={f('taux_fg_default')}
                onChange={(e) => setForm({ ...form, taux_fg_default: e.target.value })} />
              <span className="muted">%</span>
            </div>
            <span className="muted" style={{ fontSize: 10 }}>Ex : 25 = 25% de frais généraux</span>
          </Field>
          <Field label="% Bénéfice">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="input" style={{ width: 80, background: '#f0fff4' }}
                value={f('taux_ben_default')}
                onChange={(e) => setForm({ ...form, taux_ben_default: e.target.value })} />
              <span className="muted">%</span>
            </div>
            <span className="muted" style={{ fontSize: 10 }}>Ex : 10 = 10% de marge</span>
          </Field>
        </Row>
        <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', marginTop: 10, fontSize: 11 }}>
          <strong>Formule Prix de Vente</strong><br />
          PV = Débours × (1 + FG%) × (1 + Bénéfice%)<br />
          Coeff. global = ×{coeff} pour FG={f('taux_fg_default')}% / Bénéfice={f('taux_ben_default')}%<br />
          <span className="muted">Ces valeurs sont pré-remplies à la création d'un devis. Modifiables par devis.</span>
        </div>
      </Card>

      {/* ── Onglet par défaut ── */}
      <Card title="Devis — onglet ouvert par défaut">
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 11 }}>
          Onglet affiché automatiquement à l'ouverture d'un devis existant.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {DEFAULT_TABS.map((tab) => (
            <label key={tab.v} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              cursor: 'pointer', fontSize: 12,
              background: currentTab === tab.v ? 'var(--bg-alt)' : '#fff',
              borderBottom: '1px solid var(--border)',
            }}>
              <input type="radio" name="default_tab" value={tab.v}
                checked={currentTab === tab.v}
                onChange={() => setDefaultTab(tab.v)}
                style={{ accentColor: 'var(--primary)' }} />
              {tab.l}
            </label>
          ))}
        </div>
      </Card>

      {/* ── Affichage des décimales ── */}
      <Card title="Affichage des décimales">
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 11 }}>
          Nombre de chiffres après la virgule affichés dans les tableaux et montants.
          Les calculs se font toujours avec 4 décimales. Les PDF s'arrêtent toujours à 2.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {[2, 3, 4].map((n) => (
            <label key={n} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              border: `2px solid ${currentNbDec === n ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: currentNbDec === n ? 'var(--primary)' : '#fff',
              color: currentNbDec === n ? '#fff' : 'var(--text)',
            }}>
              <input type="radio" name="nb_dec" value={n}
                checked={currentNbDec === n}
                onChange={() => setNbDec(n)}
                style={{ display: 'none' }} />
              {n} décimales
            </label>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 10, marginTop: 4 }}>
          Ex. avec 2 : 1 234,56 €  ·  avec 3 : 1 234,567 €  ·  avec 4 : 1 234,5678 €
        </span>
      </Card>

      {/* ── Numérotation ── */}
      <Card title="Numérotation des devis">
        <Row>
          <Field label="Préfixe">
            <input className="input" style={{ width: 100 }} value={f('devis_prefix')}
              onChange={(e) => setForm({ ...form, devis_prefix: e.target.value })} />
            <span className="muted" style={{ fontSize: 10 }}>Exemple : DEV-2026-0001</span>
          </Field>
          <Field label="Séparateur">
            <input className="input" style={{ width: 60 }} value={f('devis_separator')}
              onChange={(e) => setForm({ ...form, devis_separator: e.target.value })} />
            <span className="muted" style={{ fontSize: 10 }}>Entre le préfixe et l'année</span>
          </Field>
        </Row>
      </Card>

      {/* ── Couleurs ── */}
      <Card title="Couleurs de l'application (app et PDF)">
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 11 }}>
          Les changements sont prévisualisés immédiatement dans l'interface. Cliquez Enregistrer pour les conserver.
        </p>
        <Row>
          <ColorPicker
            label="Couleur principale"
            hint="Sidebar, en-têtes de section, titres — navy par défaut"
            value={f('couleur_principale') || '#1a3a5c'}
            onChange={(v) => {
              setForm({ ...form, couleur_principale: v });
              document.documentElement.style.setProperty('--primary', v);
            }}
          />
          <ColorPicker
            label="Couleur d'accent"
            hint="Boutons, codes analytiques, badges actifs — orange par défaut"
            value={f('couleur_accent') || '#e8550a'}
            onChange={(v) => {
              setForm({ ...form, couleur_accent: v });
              document.documentElement.style.setProperty('--accent', v);
            }}
          />
        </Row>
        {/* Aperçu live */}
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-alt)', fontSize: 11 }}>
          <strong style={{ color: 'var(--primary)' }}>Aperçu couleur principale</strong>
          {' · '}
          <strong style={{ color: 'var(--accent)' }}>Aperçu couleur d&apos;accent</strong>
          {' · '}
          <button className="btn" style={{ padding: '2px 10px', fontSize: 10 }}>Bouton principal</button>
        </div>
      </Card>

      <SaveButton onSave={() => save.mutate()} isPending={save.isPending} saved={saved} />
    </div>
  );
}

/* ─────────── Shared components ─────────── */

/* ─────────── Barre d'actions groupées ─────────── */
function BulkBar({ count, onDelete, isPending, actions }: {
  count: number;
  onDelete: () => void;
  isPending: boolean;
  actions?: { label: string; onClick: () => void }[];
}) {
  const btnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
    padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
      background: 'var(--primary)', color: '#fff', borderRadius: 6, fontSize: 12,
    }}>
      <span style={{ fontWeight: 700 }}>{count} sélectionné{count > 1 ? 's' : ''}</span>
      <div style={{ flex: 1 }} />
      {actions?.map((a) => (
        <button key={a.label} style={btnStyle} onClick={a.onClick} disabled={isPending}>{a.label}</button>
      ))}
      <button
        style={{ background: '#e53e3e', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, cursor: isPending ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: isPending ? 0.7 : 1 }}
        onClick={onDelete} disabled={isPending}>
        {isPending ? '…' : `Supprimer (${count})`}
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent)', marginBottom: 14 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function RefTable({ rows, headers, onEdit, onDelete, ids, selectedIds, onToggle, onToggleAll }: {
  rows: string[][];
  headers: string[];
  onEdit: (i: number) => void;
  onDelete: (i: number) => void;
  ids?: string[];
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
}) {
  const selectable = Boolean(ids && selectedIds && onToggle && onToggleAll);
  const allSelected = selectable && ids!.length > 0 && ids!.every((id) => selectedIds!.has(id));
  const someSelected = selectable && selectedIds!.size > 0 && !allSelected;
  const cbRef = (el: HTMLInputElement | null) => { if (el) el.indeterminate = someSelected; };

  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>Aucun élément.</p>;
  return (
    <table className="grid">
      <thead>
        <tr>
          {selectable && <th style={{ width: 36 }}><input type="checkbox" ref={cbRef} checked={allSelected} onChange={onToggleAll} /></th>}
          {headers.map((h) => <th key={h}>{h}</th>)}
          <th style={{ width: 72 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const id = ids?.[i];
          const isSelected = id ? selectedIds?.has(id) : false;
          return (
            <tr key={i} style={{ background: isSelected ? '#f0f4ff' : undefined }}>
              {selectable && id && <td><input type="checkbox" checked={isSelected} onChange={() => onToggle!(id)} /></td>}
              {row.map((cell, j) => <td key={j}>{cell}</td>)}
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn-ghost btn" onClick={() => onEdit(i)}>✎</button>
                <button className="btn-danger btn" onClick={() => onDelete(i)}>✕</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SaveButton({ onSave, isPending, saved }: { onSave: () => void; isPending: boolean; saved: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 34 }}>
      {/* Largeur fixe → le texte Enregistrement… / Enregistrer ne fait pas varier la taille */}
      <button
        className="btn"
        style={{ width: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}
        onClick={onSave}
        disabled={isPending}
      >
        <span style={{ fontSize: 13 }}>💾</span>
        <span>{isPending ? 'Enregistrement…' : 'Enregistrer'}</span>
      </button>
      <span style={{
        color: '#2d7a47', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        opacity: saved ? 1 : 0,
        transition: 'opacity 0.4s ease',
        pointerEvents: 'none',
      }}>
        Paramètres sauvegardés ✓
      </span>
    </div>
  );
}

function ColorPicker({ label, hint, value, onChange }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          style={{ width: 44, height: 36, border: '2px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2, flexShrink: 0 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 100, fontFamily: 'monospace', letterSpacing: '0.04em' }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <span className="muted" style={{ fontSize: 10 }}>{hint}</span>
    </Field>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '24px 28px', minWidth: 380, maxWidth: 520, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>
  );
}
