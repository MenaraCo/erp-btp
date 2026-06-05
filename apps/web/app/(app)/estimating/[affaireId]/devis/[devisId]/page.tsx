'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';

interface Version { id: string; version_no: number; label: string }
interface DevisDetail {
  devis: { id: string; numero: string | null; designation: string; type: string; status: string };
  versions: Version[];
}
interface DevisLine {
  id: string;
  parent_line_id: string | null;
  type: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  pu_vente: string | null;
  pu_vente_force: boolean;
  sort_order: number;
}
interface SaleItem {
  id: string;
  debourse: string;
  revient: string;
  pvComputed: string;
  pv: string;
  forced: boolean;
  margeBrute: string;
  margeNette: string;
  ventilatedFrais: string;
}
interface SaleSheet {
  items: SaleItem[];
  totalDebourse: string;
  totalRevient: string;
  pvHorsFrais: string;
  fraisAnnexes: string;
  pvDevis: string;
  remise: string;
  totalPvHt: string;
  margeBrute: string;
  margeNette: string;
  coeffGlobalReel: string;
  tva: string;
  totalTtc: string;
}
type Nat = 'labor' | 'material' | 'equipment' | 'subcontract';
const NATURE_LABELS: Record<Nat, string> = {
  labor: "Main d'œuvre", material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
};
interface FraisRow { designation: string; type: 'pct' | 'fixe'; valeur: string }
interface SaleConfig {
  configured: boolean;
  byNature: Record<Nat, { tauxFg: string; tauxBenefice: string }> | null;
  remise: { type: 'pct' | 'fixe'; valeur: string } | null;
  tvaRate: string | null;
  fraisAnnexes: { designation: string; type: 'pct' | 'fixe'; valeur: string }[];
}
interface Library { id: string; code: string; name: string }
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string }
interface Page<T> { rows: T[] }

const TYPE_LABELS: Record<string, string> = { titre: 'Titre', sous_titre: 'Sous-titre', ouvrage: 'Ouvrage', ressource: 'Ressource' };
/** Étape suivante canonique du workflow d'affaire. */
const NEXT_STATUS: Record<string, string> = {
  open: 'study', study: 'coeffs_proposed', coeffs_proposed: 'coeffs_validated',
  coeffs_validated: 'sent', sent: 'won',
};

function orderTree(lines: DevisLine[]): { line: DevisLine; depth: number }[] {
  const byParent = new Map<string | null, DevisLine[]>();
  for (const l of lines) (byParent.get(l.parent_line_id) ?? byParent.set(l.parent_line_id, []).get(l.parent_line_id)!).push(l);
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
  const out: { line: DevisLine; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of byParent.get(parent) ?? []) { out.push({ line: l, depth }); walk(l.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export default function DevisEditorPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const affaireId = String(params.affaireId);
  const devisId = String(params.devisId);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [marcheMsg, setMarcheMsg] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['devis', devisId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisDetail>(`/devis/${devisId}`, { token }),
  });
  const versionId = detail.data?.versions[detail.data.versions.length - 1]?.id;
  const latest = detail.data?.versions[detail.data.versions.length - 1];

  const lines = useQuery({
    queryKey: ['lines', versionId],
    enabled: Boolean(token && versionId),
    queryFn: () => apiFetch<DevisLine[]>(`/versions/${versionId}/lines`, { token }),
  });
  const sale = useQuery({
    queryKey: ['sale-sheet', versionId],
    enabled: Boolean(token && versionId),
    retry: false,
    queryFn: () => apiFetch<SaleSheet>(`/versions/${versionId}/sale-sheet`, { token }),
  });
  const saleConfig = useQuery({
    queryKey: ['sale-config', versionId],
    enabled: Boolean(token && versionId),
    retry: false,
    queryFn: () => apiFetch<SaleConfig>(`/versions/${versionId}/sale-sheet/config`, { token }),
  });
  const libs = useQuery({
    queryKey: ['libraries'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });

  const ordered = useMemo(() => orderTree(lines.data ?? []), [lines.data]);
  const parents = ordered.filter((o) => o.line.type === 'titre' || o.line.type === 'sous_titre');

  function refresh() {
    qc.invalidateQueries({ queryKey: ['lines', versionId] });
    qc.invalidateQueries({ queryKey: ['sale-sheet', versionId] });
    qc.invalidateQueries({ queryKey: ['sale-config', versionId] });
  }

  const status = detail.data?.devis.status ?? 'open';
  const advance = useMutation({
    mutationFn: () => apiFetch(`/devis/${devisId}/transition`, { method: 'POST', body: { to: NEXT_STATUS[status] }, token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis', devisId] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const accept = useMutation({
    mutationFn: () => apiFetch<{ marche: { id: string; code: string } }>(`/devis/${devisId}/accept`, { method: 'POST', body: {}, token }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['devis', devisId] });
      setMarcheMsg(`Marché ${res.marche.code} créé.`);
      router.push(`/invoicing/${res.marche.id}`);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- add line ---
  const [pl, setPl] = useState({ parentId: '', type: 'titre', code: '', designation: '', libId: '', ouvrageId: '', unit: '', quantity: '', formula: '' });
  const ouvragesOfLib = useQuery({
    queryKey: ['ouvrages', pl.libId],
    enabled: Boolean(token && pl.libId),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${pl.libId}/ouvrages?pageSize=200`, { token }),
  });

  const addLine = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        type: pl.type,
        parentLineId: pl.parentId || null,
        code: pl.code || null,
        designation: pl.designation,
      };
      if (pl.type === 'ouvrage') {
        body.sourceOuvrageId = pl.ouvrageId;
        body.unit = pl.unit || null;
        if (pl.formula) body.quantityFormula = pl.formula;
        else body.quantity = pl.quantity || '0';
      }
      return apiFetch(`/versions/${versionId}/lines`, { method: 'POST', body, token });
    },
    onSuccess: () => {
      refresh();
      setPl({ ...pl, code: '', designation: '', ouvrageId: '', unit: '', quantity: '', formula: '' });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- métré variable ---
  const [varForm, setVarForm] = useState({ name: '', value: '' });
  const setVar = useMutation({
    mutationFn: () => apiFetch(`/versions/${versionId}/variables/${varForm.name}`, { method: 'PUT', body: { value: varForm.value || '0' }, token }),
    onSuccess: () => { refresh(); setVarForm({ name: '', value: '' }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- coefficients (feuille de vente) : FG% + Bénéfice% par nature ---
  const [coef, setCoef] = useState<Record<Nat, { fg: string; ben: string }>>({
    labor: { fg: '10', ben: '15' },
    material: { fg: '8', ben: '10' },
    equipment: { fg: '10', ben: '10' },
    subcontract: { fg: '5', ben: '5' },
  });
  const [remise, setRemise] = useState<{ type: 'pct' | 'fixe'; valeur: string }>({ type: 'pct', valeur: '0' });
  const [tva, setTva] = useState('0.20');
  const setSale = useMutation({
    mutationFn: () =>
      apiFetch(`/versions/${versionId}/sale-sheet`, {
        method: 'PUT',
        body: {
          byNature: {
            labor: { tauxFg: coef.labor.fg, tauxBenefice: coef.labor.ben },
            material: { tauxFg: coef.material.fg, tauxBenefice: coef.material.ben },
            equipment: { tauxFg: coef.equipment.fg, tauxBenefice: coef.equipment.ben },
            subcontract: { tauxFg: coef.subcontract.fg, tauxBenefice: coef.subcontract.ben },
          },
          remise: { type: remise.type, valeur: remise.valeur || '0' },
          tvaRate: tva,
        },
        token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- frais annexes (liste) ---
  const [frais, setFrais] = useState<FraisRow[]>([]);
  const setFraisAnnexes = useMutation({
    mutationFn: () =>
      apiFetch(`/versions/${versionId}/frais-annexes`, {
        method: 'PUT',
        body: { frais: frais.map((f) => ({ designation: f.designation, type: f.type, valeur: f.valeur || '0' })) },
        token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- PV forcé par ligne ---
  const [pvEdit, setPvEdit] = useState<Record<string, string>>({});
  const setLinePv = useMutation({
    mutationFn: ({ lineId, puVente, force }: { lineId: string; puVente: string | null; force: boolean }) =>
      apiFetch(`/versions/${versionId}/lines/${lineId}/pv`, {
        method: 'PUT', body: { puVente, force }, token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const itemById = useMemo(
    () => new Map((sale.data?.items ?? []).map((i) => [i.id, i])),
    [sale.data],
  );

  // Préremplit le formulaire avec la config stockée (une fois par version chargée).
  const cfgInit = useRef<string | null>(null);
  useEffect(() => {
    const cfg = saleConfig.data;
    if (!cfg || !versionId || cfgInit.current === versionId) return;
    cfgInit.current = versionId;
    if (cfg.configured && cfg.byNature) {
      const b = cfg.byNature;
      setCoef({
        labor: { fg: b.labor.tauxFg, ben: b.labor.tauxBenefice },
        material: { fg: b.material.tauxFg, ben: b.material.tauxBenefice },
        equipment: { fg: b.equipment.tauxFg, ben: b.equipment.tauxBenefice },
        subcontract: { fg: b.subcontract.tauxFg, ben: b.subcontract.tauxBenefice },
      });
      if (cfg.remise) setRemise({ type: cfg.remise.type, valeur: String(Number(cfg.remise.valeur)) });
      if (cfg.tvaRate) setTva(String(Number(cfg.tvaRate)));
    }
    setFrais((cfg.fraisAnnexes ?? []).map((f) => ({
      designation: f.designation, type: f.type, valeur: String(Number(f.valeur)),
    })));
  }, [saleConfig.data, versionId]);

  async function downloadPdf() {
    if (!versionId) return;
    setPdfError(null);
    try { window.open(await apiFetchBlobUrl(`/versions/${versionId}/devis.pdf`, token), '_blank'); }
    catch { setPdfError('PDF indisponible.'); }
  }

  const d = detail.data?.devis;
  const [tab, setTab] = useState<'etude' | 'coeffs' | 'client'>('etude');

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/estimating/${affaireId}`} className="link">← Affaire</Link>
      </p>
      {detail.isError && <p className="muted">Devis introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {d && (
        <>
          <h1 style={{ marginBottom: 4 }}>{d.numero ? `${d.numero} — ` : ''}{d.designation}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="badge">{AFFAIRE_STATUS_LABELS[d.status] ?? d.status}</span>
            {` · ${d.type}`}{latest ? ` · Version ${latest.version_no}` : ''}
          </p>

          <div className="card" style={{ marginTop: 12 }}>
            <h2>Workflow & acceptation</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {NEXT_STATUS[d.status] && (
                <button className="btn" onClick={() => { setErr(null); advance.mutate(); }} disabled={advance.isPending}>
                  Avancer → {AFFAIRE_STATUS_LABELS[NEXT_STATUS[d.status]]}
                </button>
              )}
              {d.status === 'won' && (
                <button className="btn" onClick={() => { setErr(null); accept.mutate(); }} disabled={accept.isPending}>
                  Accepter (créer le marché)
                </button>
              )}
              {d.status === 'won' && <span className="muted">Devis gagné — prêt à être accepté en marché.</span>}
              {marcheMsg && <span className="muted">{marcheMsg}</span>}
            </div>
          </div>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <div className="card"><h2>Déboursé</h2><div className="stat">{euro(sale.data?.totalDebourse)}</div></div>
            <div className="card"><h2>Prix de revient</h2><div className="stat">{euro(sale.data?.totalRevient)}</div></div>
            <div className="card">
              <h2>Total HT</h2><div className="stat">{euro(sale.data?.totalPvHt)}</div>
              {sale.data && <p className="muted" style={{ margin: 0 }}>coeff. global {Number(sale.data.coeffGlobalReel).toFixed(3)}</p>}
            </div>
            <div className="card">
              <h2>Marge nette</h2>
              <div className="stat">{euro(sale.data?.margeNette)}</div>
              {sale.data && Number(sale.data.totalPvHt) > 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  {((Number(sale.data.margeNette) / Number(sale.data.totalPvHt)) * 100).toFixed(1)} % · brute {euro(sale.data.margeBrute)}
                </p>
              )}
            </div>
            <div className="card"><h2>TVA</h2><div className="stat">{euro(sale.data?.tva)}</div></div>
            <div className="card"><h2>Total TTC</h2><div className="stat">{euro(sale.data?.totalTtc)}</div></div>
          </div>
          {sale.isError && <p className="muted">Définissez les coefficients de vente ci-dessous pour calculer les totaux.</p>}

          <div style={{ display: 'flex', gap: 4, marginTop: 16, borderBottom: '1px solid #e5e7eb' }}>
            {([['etude', 'Étude de prix'], ['coeffs', 'Coefficients & frais'], ['client', 'Devis client']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                style={{
                  padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: tab === key ? '2px solid #1e3a8a' : '2px solid transparent',
                  fontWeight: tab === key ? 600 : 400, color: tab === key ? '#1e3a8a' : '#6b7280',
                }}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'etude' && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Construire le devis</h2>
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (!pl.designation) { setErr('Désignation requise.'); return; }
                if (pl.type === 'ouvrage' && !pl.ouvrageId) { setErr('Choisissez un ouvrage.'); return; }
                addLine.mutate();
              }}
            >
              <Field label="Parent">
                <select value={pl.parentId} onChange={(e) => setPl({ ...pl, parentId: e.target.value })}>
                  <option value="">(racine)</option>
                  {parents.map((p) => <option key={p.line.id} value={p.line.id}>{'— '.repeat(p.depth)}{p.line.code} {p.line.designation}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select value={pl.type} onChange={(e) => setPl({ ...pl, type: e.target.value })}>
                  <option value="titre">Titre</option>
                  <option value="sous_titre">Sous-titre</option>
                  <option value="ouvrage">Ouvrage</option>
                </select>
              </Field>
              <Field label="Code"><input style={{ width: 70 }} value={pl.code} onChange={(e) => setPl({ ...pl, code: e.target.value })} /></Field>
              <Field label="Désignation"><input value={pl.designation} onChange={(e) => setPl({ ...pl, designation: e.target.value })} /></Field>
              {pl.type === 'ouvrage' && (
                <>
                  <Field label="Bibliothèque">
                    <select value={pl.libId} onChange={(e) => setPl({ ...pl, libId: e.target.value, ouvrageId: '' })}>
                      <option value="">—</option>
                      {(libs.data?.rows ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
                    </select>
                  </Field>
                  <Field label="Ouvrage">
                    <select
                      value={pl.ouvrageId}
                      onChange={(e) => {
                        const o = (ouvragesOfLib.data?.rows ?? []).find((x) => x.id === e.target.value);
                        setPl({ ...pl, ouvrageId: e.target.value, unit: o?.unit ?? pl.unit, designation: pl.designation || (o?.label ?? '') });
                      }}
                    >
                      <option value="">—</option>
                      {(ouvragesOfLib.data?.rows ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} ({euro(o.debourse)})</option>)}
                    </select>
                  </Field>
                  <Field label="Quantité (métré)"><input style={{ width: 80 }} value={pl.quantity} onChange={(e) => setPl({ ...pl, quantity: e.target.value })} /></Field>
                  <Field label="ou formule"><input style={{ width: 110 }} placeholder="ex: surface*2" value={pl.formula} onChange={(e) => setPl({ ...pl, formula: e.target.value })} /></Field>
                </>
              )}
              <button className="btn" type="submit" disabled={addLine.isPending}>+ Ligne</button>
            </form>

            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); if (varForm.name) setVar.mutate(); }}
            >
              <Field label="Variable de métré"><input placeholder="nom (ex: surface)" value={varForm.name} onChange={(e) => setVarForm({ ...varForm, name: e.target.value })} /></Field>
              <Field label="Valeur"><input style={{ width: 90 }} value={varForm.value} onChange={(e) => setVarForm({ ...varForm, value: e.target.value })} /></Field>
              <button className="btn" type="submit">Définir variable</button>
            </form>
          </div>
          )}

          {tab === 'etude' && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Corps du devis — déboursé</h2>
            {ordered.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr>
                  <th>Désignation</th><th>Type</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }}>Déboursé</th>
                </tr></thead>
                <tbody>
                  {ordered.map(({ line, depth }) => {
                    const item = itemById.get(line.id);
                    return (
                      <tr key={line.id}>
                        <td style={{ paddingLeft: 8 + depth * 20 }}>{line.code ? <strong>{line.code} </strong> : null}{line.designation}</td>
                        <td className="muted">{TYPE_LABELS[line.type] ?? line.type}</td>
                        <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>{item ? euro(item.debourse) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Devis vide — ajoutez un titre puis des ouvrages ci-dessus.</p>}
          </div>
          )}

          {tab === 'coeffs' && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Feuille de vente — coefficients par nature</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Déboursé × (1 + FG %) = prix de revient, puis × (1 + Bénéfice %) = prix de vente.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); setErr(null); setSale.mutate(); }}>
              <table className="grid" style={{ marginBottom: 12 }}>
                <thead><tr><th>Nature</th><th style={{ textAlign: 'right' }}>FG %</th><th style={{ textAlign: 'right' }}>Bénéfice %</th><th style={{ textAlign: 'right' }}>Coeff.</th></tr></thead>
                <tbody>
                  {(Object.keys(NATURE_LABELS) as Nat[]).map((n) => {
                    const c = coef[n];
                    const k = (1 + Number(c.fg) / 100) * (1 + Number(c.ben) / 100);
                    return (
                      <tr key={n}>
                        <td>{NATURE_LABELS[n]}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input style={{ width: 64, textAlign: 'right' }} value={c.fg}
                            onChange={(e) => setCoef({ ...coef, [n]: { ...c, fg: e.target.value } })} />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input style={{ width: 64, textAlign: 'right' }} value={c.ben}
                            onChange={(e) => setCoef({ ...coef, [n]: { ...c, ben: e.target.value } })} />
                        </td>
                        <td style={{ textAlign: 'right' }} className="muted">{k.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="Remise">
                  <select value={remise.type} onChange={(e) => setRemise({ ...remise, type: e.target.value as 'pct' | 'fixe' })}>
                    <option value="pct">% du devis</option>
                    <option value="fixe">Montant fixe</option>
                  </select>
                </Field>
                <Field label="Valeur remise"><input style={{ width: 80 }} value={remise.valeur} onChange={(e) => setRemise({ ...remise, valeur: e.target.value })} /></Field>
                <Field label="TVA (ex: 0.20)"><input style={{ width: 80 }} value={tva} onChange={(e) => setTva(e.target.value)} /></Field>
                <button className="btn" type="submit" disabled={setSale.isPending}>Appliquer</button>
              </div>
            </form>
          </div>
          )}

          {tab === 'coeffs' && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Frais annexes</h2>
              <button className="btn" type="button" onClick={() => setFrais([...frais, { designation: '', type: 'pct', valeur: '0' }])}>+ Poste</button>
            </div>
            {frais.length === 0 ? (
              <p className="muted">Aucun poste. Ex : compte prorata (% du PV) ou installation de chantier (montant fixe).</p>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); setErr(null); setFraisAnnexes.mutate(); }}>
                <table className="grid" style={{ marginBottom: 12 }}>
                  <thead><tr><th>Désignation</th><th>Type</th><th style={{ textAlign: 'right' }}>Valeur</th><th /></tr></thead>
                  <tbody>
                    {frais.map((f, i) => (
                      <tr key={i}>
                        <td><input style={{ width: '100%' }} value={f.designation}
                          onChange={(e) => setFrais(frais.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))} /></td>
                        <td>
                          <select value={f.type} onChange={(e) => setFrais(frais.map((x, j) => j === i ? { ...x, type: e.target.value as 'pct' | 'fixe' } : x))}>
                            <option value="pct">% du PV</option>
                            <option value="fixe">Fixe</option>
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}><input style={{ width: 80, textAlign: 'right' }} value={f.valeur}
                          onChange={(e) => setFrais(frais.map((x, j) => j === i ? { ...x, valeur: e.target.value } : x))} /></td>
                        <td><button className="btn" type="button" onClick={() => setFrais(frais.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn" type="submit" disabled={setFraisAnnexes.isPending}>Enregistrer les frais</button>
                {sale.data && <span className="muted" style={{ marginLeft: 12 }}>Total frais appliqué : {euro(sale.data.fraisAnnexes)}</span>}
              </form>
            )}
          </div>
          )}

          {tab === 'client' && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Corps du devis — prix de vente</h2>
              <button className="btn" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
            </div>
            {pdfError && <p className="muted">{pdfError}</p>}
            {ordered.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr>
                  <th>Désignation</th><th>Type</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }}>Déboursé</th>
                  <th style={{ textAlign: 'right' }}>PV calculé</th>
                  <th style={{ textAlign: 'right' }}>PV retenu</th>
                  <th />
                </tr></thead>
                <tbody>
                  {ordered.map(({ line, depth }) => {
                    const item = itemById.get(line.id);
                    return (
                      <tr key={line.id} style={item?.forced ? { background: '#fff7ed' } : undefined}>
                        <td style={{ paddingLeft: 8 + depth * 20 }}>{line.code ? <strong>{line.code} </strong> : null}{line.designation}</td>
                        <td className="muted">{TYPE_LABELS[line.type] ?? line.type}</td>
                        <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>{item ? euro(item.debourse) : '—'}</td>
                        <td style={{ textAlign: 'right' }} className="muted">{item ? euro(item.pvComputed) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: item?.forced ? 600 : undefined, color: item?.forced ? '#c2410c' : undefined }}>
                          {item ? euro(item.pv) : '—'}{item?.forced ? ' (forcé)' : ''}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {item && (item.forced ? (
                            <button className="btn" type="button" disabled={setLinePv.isPending}
                              onClick={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })}>Libérer</button>
                          ) : (
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              <input style={{ width: 70, textAlign: 'right' }} placeholder="PU vente"
                                value={pvEdit[line.id] ?? ''}
                                onChange={(e) => setPvEdit({ ...pvEdit, [line.id]: e.target.value })} />
                              <button className="btn" type="button" disabled={setLinePv.isPending || !pvEdit[line.id]}
                                onClick={() => setLinePv.mutate({ lineId: line.id, puVente: pvEdit[line.id], force: true })}>Forcer</button>
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Devis vide — ajoutez un titre puis des ouvrages ci-dessus.</p>}
          </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}
