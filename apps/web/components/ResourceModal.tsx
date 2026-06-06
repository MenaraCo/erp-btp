'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';

/* ─────────── types ─────────── */
export interface FullResource {
  id: string;
  code: string;
  label: string;
  unit: string;
  nature: string;
  unitCost: string;
  codeProduit?: string | null;
  codeAnalytiqueId?: string | null;
  prixPublic?: string | null;
  uniteAchat?: string | null;
  coeffConversion?: string | null;
  supplierId?: string | null;
  refFournisseur?: string | null;
  conditionnement?: string | null;
}

interface Unit { id: string; abrev: string; label: string }
interface Famille { id: string; code: string; label: string }
interface Code { id: string; code: string; label: string; famille_id: string }
interface Supplier { id: string; code: string; name: string }

const NATURES = [
  { v: 'material', l: 'Matériau' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];

const empty = {
  code: '', label: '', unit: '', nature: 'material', unitCost: '',
  codeProduit: '', codeAnalytiqueId: '', prixPublic: '', uniteAchat: '',
  coeffConversion: '1', supplierId: '', refFournisseur: '', conditionnement: '',
};

/* ═══════════════════════════════════════════════════════════ */
export function ResourceModal({ libId, resource, onClose }: {
  libId: string;
  resource: FullResource | null; // null = création
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const isEdit = Boolean(resource);

  /* Référentiels (listes déroulantes dynamiques) */
  const units = useQuery({ queryKey: ['params-units'], enabled: Boolean(token),
    queryFn: () => apiFetch<Unit[]>('/params/units', { token }) });
  const familles = useQuery({ queryKey: ['params-familles'], enabled: Boolean(token),
    queryFn: () => apiFetch<Famille[]>('/params/familles', { token }) });
  const codes = useQuery({ queryKey: ['params-codes'], enabled: Boolean(token),
    queryFn: () => apiFetch<Code[]>('/params/codes', { token }) });
  const suppliers = useQuery({ queryKey: ['suppliers-all'], enabled: Boolean(token),
    queryFn: () => apiFetch<{ rows: Supplier[] }>('/suppliers?pageSize=300', { token }) });

  /* État formulaire */
  const [f, setF] = useState({ ...empty });
  // Famille = filtre UI pour les codes analytiques (la ressource stocke le code, pas la famille)
  const [familleFilter, setFamilleFilter] = useState('');

  /* Pré-remplissage à l'ouverture */
  useEffect(() => {
    if (resource) {
      setF({
        code: resource.code ?? '', label: resource.label ?? '', unit: resource.unit ?? '',
        nature: resource.nature ?? 'material', unitCost: resource.unitCost ?? '',
        codeProduit: resource.codeProduit ?? '', codeAnalytiqueId: resource.codeAnalytiqueId ?? '',
        prixPublic: resource.prixPublic ?? '', uniteAchat: resource.uniteAchat ?? '',
        coeffConversion: resource.coeffConversion ?? '1', supplierId: resource.supplierId ?? '',
        refFournisseur: resource.refFournisseur ?? '', conditionnement: resource.conditionnement ?? '',
      });
    } else {
      setF({ ...empty });
    }
  }, [resource]);

  /* Déduire la famille depuis le code analytique sélectionné (pour le filtre) */
  useEffect(() => {
    if (f.codeAnalytiqueId && codes.data) {
      const c = codes.data.find((x) => x.id === f.codeAnalytiqueId);
      if (c) setFamilleFilter(c.famille_id);
    }
  }, [f.codeAnalytiqueId, codes.data]);

  /* PU Débours auto-calculé = PU Public ÷ coeff (modifiable) */
  function setPrixPublic(v: string) {
    const coeff = Number(f.coeffConversion) || 0;
    const pub = Number(v) || 0;
    setF((s) => ({ ...s, prixPublic: v, unitCost: coeff > 0 && pub > 0 ? String(+(pub / coeff).toFixed(4)) : s.unitCost }));
  }
  function setCoeff(v: string) {
    const coeff = Number(v) || 0;
    const pub = Number(f.prixPublic) || 0;
    setF((s) => ({ ...s, coeffConversion: v, unitCost: coeff > 0 && pub > 0 ? String(+(pub / coeff).toFixed(4)) : s.unitCost }));
  }

  const debCalcule = (() => {
    const coeff = Number(f.coeffConversion) || 0;
    const pub = Number(f.prixPublic) || 0;
    if (coeff > 0 && pub > 0) return +(pub / coeff).toFixed(4);
    return null;
  })();

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code, label: f.label, unit: f.unit, nature: f.nature,
        unitCost: f.unitCost || '0',
        codeProduit: f.codeProduit || f.code,
        codeAnalytiqueId: f.codeAnalytiqueId || null,
        prixPublic: f.prixPublic || null,
        uniteAchat: f.uniteAchat || null,
        coeffConversion: f.coeffConversion || '1',
        supplierId: f.supplierId || null,
        refFournisseur: f.refFournisseur || null,
        conditionnement: f.conditionnement || null,
      };
      return isEdit
        ? apiFetch(`/libraries/${libId}/resources/${resource!.id}`, { method: 'PUT', body, token })
        : apiFetch(`/libraries/${libId}/resources`, { method: 'POST', body, token });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', libId] });
      qc.invalidateQueries({ queryKey: ['ouvrages', libId] });
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const codesFiltered = (codes.data ?? []).filter((c) => !familleFilter || c.famille_id === familleFilter);
  const unitOptions = units.data ?? [];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16 }}>{isEdit ? 'Modifier la ressource' : 'Nouvelle ressource'}</strong>
          <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        {/* ── IDENTIFICATION ── */}
        <SectionTitle>Identification</SectionTitle>
        <Grid>
          <Field label="Code">
            <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="input" value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>
              {NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
        </Grid>
        <Field label="Désignation *">
          <input className="input" style={{ width: '100%' }} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <Grid>
          <Field label="Famille">
            <select className="input" value={familleFilter} onChange={(e) => { setFamilleFilter(e.target.value); setF({ ...f, codeAnalytiqueId: '' }); }}>
              <option value="">— toutes —</option>
              {(familles.data ?? []).map((fa) => <option key={fa.id} value={fa.id}>{fa.code} — {fa.label}</option>)}
            </select>
          </Field>
          <Field label="Unité d'emploi">
            <select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              <option value="">— choisir —</option>
              {unitOptions.map((un) => <option key={un.id} value={un.abrev}>{un.abrev} — {un.label}</option>)}
            </select>
          </Field>
        </Grid>

        {/* ── TARIFICATION ── */}
        <SectionTitle>Tarification</SectionTitle>
        <Grid>
          <Field label="PU Public (€)">
            <input className="input" value={f.prixPublic} onChange={(e) => setPrixPublic(e.target.value)} />
            <Hint>Prix catalogue — pour 1 {f.uniteAchat || "unité d'achat"}</Hint>
          </Field>
          <Field label="PU Débours (€)">
            <input className="input" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} />
            <Hint>Prix d'achat réel — pour 1 {f.unit || "unité d'emploi"}</Hint>
          </Field>
        </Grid>
        {debCalcule != null && (
          <div style={infoBox}>
            PU Débours = PU Public ÷ {f.coeffConversion} = <strong>{debCalcule} €/{f.unit || 'U'}</strong>
          </div>
        )}
        <Field label="Code analytique">
          <select className="input" style={{ width: '100%' }} value={f.codeAnalytiqueId} onChange={(e) => setF({ ...f, codeAnalytiqueId: e.target.value })}>
            <option value="">— non classé —</option>
            {codesFiltered.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}
          </select>
        </Field>

        {/* ── ACHAT & DISTRIBUTEUR ── */}
        <SectionTitle>Achat &amp; distributeur</SectionTitle>
        <Grid>
          <Field label="Distributeur">
            <select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">— aucun —</option>
              {(suppliers.data?.rows ?? []).map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </Field>
          <Field label="Référence distributeur">
            <input className="input" value={f.refFournisseur} onChange={(e) => setF({ ...f, refFournisseur: e.target.value })} />
          </Field>
        </Grid>
        <Grid>
          <Field label="Conditionnement">
            <input className="input" placeholder="Ex: Sac 25kg, Bidon 10L…" value={f.conditionnement} onChange={(e) => setF({ ...f, conditionnement: e.target.value })} />
          </Field>
          <Field label="Unité d'achat">
            <select className="input" value={f.uniteAchat ?? ''} onChange={(e) => setF({ ...f, uniteAchat: e.target.value })}>
              <option value="">— choisir —</option>
              {unitOptions.map((un) => <option key={un.id} value={un.abrev}>{un.abrev} — {un.label}</option>)}
            </select>
          </Field>
        </Grid>
        <Field label="Coefficient de conversion">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input className="input" style={{ width: 100 }} value={f.coeffConversion} onChange={(e) => setCoeff(e.target.value)} />
            {f.uniteAchat && f.unit && Number(f.coeffConversion) > 0 && (
              <span style={{ ...infoBox, margin: 0, flex: 1 }}>
                1 {f.uniteAchat} = {f.coeffConversion} {f.unit} · 1 {f.unit} = {+(1 / Number(f.coeffConversion)).toFixed(5)} {f.uniteAchat}
              </span>
            )}
          </div>
        </Field>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn-secondary btn" onClick={onClose}>Annuler</button>
          <button className="btn" disabled={!f.code || !f.label || save.isPending}
            onClick={() => { setErr(null); save.mutate(); }}>
            {save.isPending ? '…' : isEdit ? 'Modifier' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── sous-composants ─────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em',
      color: 'var(--accent)', margin: '18px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)',
    }}>{children}</div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="muted" style={{ fontSize: 10 }}>{children}</span>;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto',
};
const panel: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: '24px 28px', width: 620, maxWidth: '100%',
  boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
};
const infoBox: React.CSSProperties = {
  background: 'var(--bg-alt, #f1f5f9)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '8px 12px', fontSize: 11, margin: '0 0 12px', fontFamily: 'monospace',
};
