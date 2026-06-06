'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* ─────────── hook token ─────────── */
function useApi() {
  const { token } = useAuth();
  return useCallback(<T = unknown>(path: string, opts: Parameters<typeof apiFetch>[1] = {}) =>
    apiFetch<T>(path, { ...opts, token }), [token]);
}

/* ─────────── helpers ─────────── */

const NATURES: { v: string; l: string }[] = [
  { v: 'labor', l: 'Main d\'œuvre' },
  { v: 'material', l: 'Matériaux' },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];
const naturLabel = (v: string) => NATURES.find((n) => n.v === v)?.l ?? v;

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
interface Lot { id: string; nature: string; code: string; label: string }
interface Famille { id: string; lot_id: string; code: string; label: string; nature: string; lot_code: string; lot_label: string }
interface Code { id: string; famille_id: string; code: string; label: string; famille_code: string; famille_label: string; nature: string; lot_code: string }
interface Company { id: string; code: string; name: string; address?: string; postal_code?: string; city?: string; phone?: string; email?: string; legal_form?: string; siret?: string; vat_intra?: string; rcs?: string; capital?: string }
interface Preferences { id: string; resp_nom?: string; resp_telephone?: string; resp_email?: string; taux_fg_default: string; taux_ben_default: string; devis_prefix: string; devis_separator: string; couleur_principale: string }

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
  const { data: company } = useQuery<Company>({
    queryKey: ['params-company'],
    queryFn: () => api<Company>('/params/company'),
    enabled: Boolean(token),
  });
  const [form, setForm] = useState<Partial<Company>>({});
  const f = (k: keyof Company) => (form[k] as string) ?? (company as any)?.[k] ?? '';

  const save = useMutation({
    mutationFn: () => api(`/params/company/${company!.id}`, { method: 'PATCH', body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-company'] }); setForm({}); },
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
      <button className="btn" style={{ width: 'fit-content' }} onClick={() => save.mutate()}>
        {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
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
  const [form, setForm] = useState({ nature: 'material', code: '', label: '' });
  const [editing, setEditing] = useState<{ id: string; code: string; label: string } | null>(null);

  const inv = () => { qc.invalidateQueries({ queryKey: ['params-lots'] }); qc.invalidateQueries({ queryKey: ['params-familles'] }); };

  const create = useMutation({
    mutationFn: () => api('/params/lots', { method: 'POST', body: form }),
    onSuccess: () => { inv(); setForm({ nature: 'material', code: '', label: '' }); },
  });
  const update = useMutation({
    mutationFn: (e: typeof editing) => api(`/params/lots/${e!.id}`, { method: 'PATCH', body: { code: e!.code, label: e!.label } }),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/lots/${id}`, { method: 'DELETE' }),
    onSuccess: inv,
  });

  const grouped = NATURES.map((n) => ({ nature: n, items: lots.filter((l) => l.nature === n.v) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {grouped.map(({ nature, items }) => items.length === 0 ? null : (
        <Card key={nature.v} title={`Lots — ${nature.l}`}>
          <RefTable
            rows={items.map((l) => [l.code, l.label])}
            headers={['Code', 'Désignation']}
            onEdit={(i) => setEditing({ id: items[i].id, code: items[i].code, label: items[i].label })}
            onDelete={(i) => { if (confirm('Supprimer ce lot ?')) del.mutate(items[i].id); }}
          />
        </Card>
      ))}
      <Card title="Ajouter un lot">
        <Row>
          <Field label="Nature">
            <select className="input" style={{ width: 180 }} value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })}>
              {NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 100 }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 280 }} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()}>+ Ajouter</button>
        </Row>
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
  const [form, setForm] = useState({ lotId: '', code: '', label: '' });
  const [editing, setEditing] = useState<{ id: string; lotId: string; code: string; label: string } | null>(null);

  const inv = () => { qc.invalidateQueries({ queryKey: ['params-familles'] }); qc.invalidateQueries({ queryKey: ['params-codes'] }); };

  const create = useMutation({
    mutationFn: () => api('/params/familles', { method: 'POST', body: form }),
    onSuccess: () => { inv(); setForm({ lotId: '', code: '', label: '' }); },
  });
  const update = useMutation({
    mutationFn: (e: typeof editing) => api(`/params/familles/${e!.id}`, { method: 'PATCH', body: { lotId: e!.lotId, code: e!.code, label: e!.label } }),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/familles/${id}`, { method: 'DELETE' }),
    onSuccess: inv,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Familles de ressources${familles.length > 0 ? ` (${familles.length})` : ''}`}>
        <RefTable
          rows={familles.map((f) => [f.code, f.label, `${f.lot_code} — ${f.lot_label}`, naturLabel(f.nature)])}
          headers={['Code', 'Désignation', 'Lot parent', 'Nature']}
          onEdit={(i) => setEditing({ id: familles[i].id, lotId: familles[i].lot_id, code: familles[i].code, label: familles[i].label })}
          onDelete={(i) => { if (confirm('Supprimer cette famille ?')) del.mutate(familles[i].id); }}
        />
      </Card>
      <Card title="Ajouter une famille">
        <Row>
          <Field label="Lot parent">
            <select className="input" style={{ width: 260 }} value={form.lotId} onChange={(e) => setForm({ ...form, lotId: e.target.value })}>
              <option value="">— choisir —</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label} ({naturLabel(l.nature)})</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 100 }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 240 }} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()}>+ Ajouter</button>
        </Row>
      </Card>
      {editing && (
        <Modal title="Modifier la famille" onClose={() => setEditing(null)}>
          <Field label="Lot parent">
            <select className="input" value={editing.lotId} onChange={(e) => setEditing({ ...editing, lotId: e.target.value })}>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label}</option>)}
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
  const [form, setForm] = useState({ familleId: '', code: '', label: '' });
  const [editing, setEditing] = useState<{ id: string; familleId: string; code: string; label: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api('/params/codes', { method: 'POST', body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-codes'] }); setForm({ familleId: '', code: '', label: '' }); },
  });
  const update = useMutation({
    mutationFn: (e: typeof editing) => api(`/params/codes/${e!.id}`, { method: 'PATCH', body: { familleId: e!.familleId, code: e!.code, label: e!.label } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-codes'] }); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/codes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['params-codes'] }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Codes analytiques${codes.length > 0 ? ` (${codes.length})` : ''}`}>
        <RefTable
          rows={codes.map((c) => [c.code, c.label, `${c.famille_code} — ${c.famille_label}`, naturLabel(c.nature)])}
          headers={['Code', 'Désignation', 'Famille', 'Nature']}
          onEdit={(i) => setEditing({ id: codes[i].id, familleId: codes[i].famille_id, code: codes[i].code, label: codes[i].label })}
          onDelete={(i) => { if (confirm('Supprimer ce code analytique ?')) del.mutate(codes[i].id); }}
        />
      </Card>
      <Card title="Ajouter un code analytique">
        <Row>
          <Field label="Famille">
            <select className="input" style={{ width: 260 }} value={form.familleId} onChange={(e) => setForm({ ...form, familleId: e.target.value })}>
              <option value="">— choisir —</option>
              {familles.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.label}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 100 }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 220 }} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()}>+ Ajouter</button>
        </Row>
      </Card>
      {editing && (
        <Modal title="Modifier le code analytique" onClose={() => setEditing(null)}>
          <Field label="Famille">
            <select className="input" value={editing.familleId} onChange={(e) => setEditing({ ...editing, familleId: e.target.value })}>
              {familles.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.label}</option>)}
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

function TabPreferences({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: prefs } = useQuery<Preferences>({
    queryKey: ['params-preferences'],
    queryFn: () => api<Preferences>('/params/preferences'),
    enabled: Boolean(token),
  });
  const [form, setForm] = useState<Partial<Preferences>>({});
  const f = (k: keyof Preferences) => (form[k] as string | undefined) ?? (prefs as any)?.[k] ?? '';

  const save = useMutation({
    mutationFn: () => api('/params/preferences', {
      method: 'PATCH',
      body: {
        respNom: f('resp_nom') || null,
        respTelephone: f('resp_telephone') || null,
        respEmail: f('resp_email') || null,
        tauxFgDefault: f('taux_fg_default') ? Number(f('taux_fg_default')) : undefined,
        tauxBenDefault: f('taux_ben_default') ? Number(f('taux_ben_default')) : undefined,
        devisPrefix: f('devis_prefix') || null,
        devisSeparator: f('devis_separator') || null,
        couleurPrincipale: f('couleur_principale') || null,
      },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['params-preferences'] }); setForm({}); },
  });

  const fg = Number(f('taux_fg_default')) || 0;
  const ben = Number(f('taux_ben_default')) || 0;
  const coeff = ((1 + fg / 100) * (1 + ben / 100)).toFixed(3);

  if (!prefs) return <p className="muted">Chargement…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card title="Responsable de l'affaire (apparaît sur les devis PDF)">
        <Row>
          <Field label="Nom"><input className="input" style={{ width: 200 }} placeholder="Prénom NOM" value={f('resp_nom')} onChange={(e) => setForm({ ...form, resp_nom: e.target.value })} /></Field>
          <Field label="Téléphone"><input className="input" style={{ width: 140 }} value={f('resp_telephone')} onChange={(e) => setForm({ ...form, resp_telephone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" style={{ width: 220 }} value={f('resp_email')} onChange={(e) => setForm({ ...form, resp_email: e.target.value })} /></Field>
        </Row>
      </Card>

      <Card title="Taux par défaut">
        <Row>
          <Field label="% Frais généraux">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="input" style={{ width: 80, background: '#fffbf0' }} type="number" step="0.5" value={f('taux_fg_default')} onChange={(e) => setForm({ ...form, taux_fg_default: e.target.value as any })} />
              <span className="muted">%</span>
            </div>
            <span className="muted" style={{ fontSize: 10 }}>Ex : 25 = 25% de frais généraux</span>
          </Field>
          <Field label="% Bénéfice">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="input" style={{ width: 80, background: '#f0fff4' }} type="number" step="0.5" value={f('taux_ben_default')} onChange={(e) => setForm({ ...form, taux_ben_default: e.target.value as any })} />
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

      <Card title="Numérotation des devis">
        <Row>
          <Field label="Préfixe">
            <input className="input" style={{ width: 100 }} value={f('devis_prefix')} onChange={(e) => setForm({ ...form, devis_prefix: e.target.value })} />
            <span className="muted" style={{ fontSize: 10 }}>Exemple : DEV-2026-0001</span>
          </Field>
          <Field label="Séparateur">
            <input className="input" style={{ width: 60 }} value={f('devis_separator')} onChange={(e) => setForm({ ...form, devis_separator: e.target.value })} />
            <span className="muted" style={{ fontSize: 10 }}>Entre le préfixe et l'année</span>
          </Field>
        </Row>
      </Card>

      <Card title="Couleur principale (app et PDF)">
        <Row>
          <Field label="Couleur principale">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" style={{ width: 44, height: 32, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: 2 }}
                value={f('couleur_principale') || '#1a3a5c'}
                onChange={(e) => setForm({ ...form, couleur_principale: e.target.value })} />
              <input className="input" style={{ width: 100, fontFamily: 'monospace' }}
                value={f('couleur_principale')}
                onChange={(e) => setForm({ ...form, couleur_principale: e.target.value })} />
            </div>
            <span className="muted" style={{ fontSize: 10 }}>Utilisée dans les en-têtes du PDF et les sections de l'app.</span>
          </Field>
        </Row>
      </Card>

      <button className="btn" style={{ width: 'fit-content' }} onClick={() => save.mutate()}>
        {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  );
}

/* ─────────── Shared components ─────────── */

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

function RefTable({ rows, headers, onEdit, onDelete }: {
  rows: string[][];
  headers: string[];
  onEdit: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>Aucun élément.</p>;
  return (
    <table className="grid">
      <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}<th style={{ width: 72 }}></th></tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j}>{cell}</td>)}
            <td style={{ display: 'flex', gap: 4 }}>
              <button className="btn-ghost btn" onClick={() => onEdit(i)}>✎</button>
              <button className="btn-danger btn" onClick={() => onDelete(i)}>✕</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
