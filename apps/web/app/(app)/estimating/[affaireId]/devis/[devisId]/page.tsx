'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';
import { Montage, MontageLine } from './Montage';

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
  perte: string | null;
  pu_vente: string | null;
  pu_vente_force: boolean;
  section_type: 'option' | 'variante' | null;
  source_ouvrage_id: string | null;
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
  const [tva, setTva] = useState('20'); // saisi en % (20 = 20 %)
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
          tvaRate: String((Number(tva) || 0) / 100), // % → fraction pour le stockage
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
  // Onglet « Devis client » : titres + lignes valorisées, SANS le sous-détail ressources
  // (les ressources enfants d'un ouvrage sont du détail de débours, pas du devis client).
  const ouvrageIds = useMemo(
    () => new Set((lines.data ?? []).filter((l) => l.type === 'ouvrage').map((l) => l.id)),
    [lines.data],
  );
  const clientLines = useMemo(
    () => ordered.filter(
      (o) => !(o.line.type === 'ressource' && o.line.parent_line_id && ouvrageIds.has(o.line.parent_line_id)),
    ),
    [ordered, ouvrageIds],
  );
  // Récapitulatif débours par titre de niveau 1 (somme du sous-arbre).
  const titreRecap = useMemo(() => {
    const byId = new Map((lines.data ?? []).map((l) => [l.id, l]));
    const rootOf = (id: string) => {
      let cur = byId.get(id);
      while (cur && cur.parent_line_id) cur = byId.get(cur.parent_line_id);
      return cur;
    };
    const totals = new Map<string, number>();
    for (const it of sale.data?.items ?? []) {
      const root = rootOf(it.id);
      if (root) totals.set(root.id, (totals.get(root.id) ?? 0) + Number(it.debourse));
    }
    return (lines.data ?? [])
      .filter((l) => !l.parent_line_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ line: r, total: totals.get(r.id) ?? 0 }));
  }, [lines.data, sale.data]);

  // Export du déboursé par ressource (CSV — s'ouvre dans Excel).
  function exportDebours() {
    const byId = new Map((lines.data ?? []).map((l) => [l.id, l]));
    const agg = new Map<string, { code: string; designation: string; qty: number; pu: number; montant: number }>();
    for (const l of lines.data ?? []) {
      if (l.type !== 'ressource') continue;
      const parent = l.parent_line_id ? byId.get(l.parent_line_id) : undefined;
      const ouvrageQty = parent?.type === 'ouvrage' ? Number(parent.quantity) || 0 : 1;
      const qty = ouvrageQty * (Number(l.quantity) || 0) * (1 + (Number(l.perte) || 0) / 100);
      const pu = Number(l.pu) || 0;
      const key = `${l.code ?? ''}|${l.designation}`;
      const cur = agg.get(key) ?? { code: l.code ?? '', designation: l.designation, qty: 0, pu, montant: 0 };
      cur.qty += qty;
      cur.montant += qty * pu;
      agg.set(key, cur);
    }
    const rows: (string | number)[][] = [['Code', 'Désignation', 'Quantité', 'PU déboursé', 'Montant HT']];
    for (const r of agg.values()) rows.push([r.code, r.designation, r.qty.toFixed(3), r.pu.toFixed(4), r.montant.toFixed(2)]);
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debours_${d?.numero || devisId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
      if (cfg.tvaRate) setTva(String(Number(cfg.tvaRate) * 100)); // fraction → %
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
            <span className={d.status === "won" ? "badge success" : d.status === "lost" ? "badge danger" : (d.status === "sent" || d.status === "coeffs_validated") ? "badge info" : "badge"}>{AFFAIRE_STATUS_LABELS[d.status] ?? d.status}</span>
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

          <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid var(--border)' }}>
            {([['etude', 'Étude de prix'], ['coeffs', 'Coefficients & frais'], ['client', 'Devis client']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className="editor-tab"
                style={{
                  borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
                  fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--primary)' : 'var(--muted)',
                }}>
                {label}
              </button>
            ))}
          </div>

          <div className="editor-grid">
            <div className="editor-main" data-panel="1">

          {tab === 'etude' && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Corps du devis</h2>
              <form
                style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
                onSubmit={(e) => { e.preventDefault(); setErr(null); if (varForm.name) setVar.mutate(); }}
              >
                <Field label="Variable de métré"><input placeholder="ex: surface" value={varForm.name} onChange={(e) => setVarForm({ ...varForm, name: e.target.value })} /></Field>
                <Field label="Valeur"><input style={{ width: 80 }} value={varForm.value} onChange={(e) => setVarForm({ ...varForm, value: e.target.value })} /></Field>
                <button className="btn" type="submit">Définir</button>
              </form>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Construisez le devis sur place : chaque titre propose « + Sous-titre / + Ouvrage / + Ligne / + Texte ». Les ouvrages copient leur sous-détail (éditable). « V » = variante, « O » = option (hors total).
            </p>
            <div style={{ marginTop: 8 }}>
              <Montage
                versionId={versionId!}
                token={token}
                lines={(lines.data ?? []) as MontageLine[]}
                deboursById={new Map((sale.data?.items ?? []).map((i) => [i.id, i.debourse]))}
                onChanged={refresh}
                readOnly={false}
              />
            </div>
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
                <Field label="TVA %"><input style={{ width: 80 }} value={tva} onChange={(e) => setTva(e.target.value)} /></Field>
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
              <h2 style={{ margin: 0 }}>Prix de vente par ligne</h2>
              <button className="btn-secondary" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>Vue commerciale : prix de vente par ligne, sans le sous-détail de débours.</p>
            {pdfError && <p className="muted">{pdfError}</p>}
            {clientLines.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr>
                  <th>Désignation</th>
                  <th style={{ textAlign: 'right' }}>Qté</th>
                  <th style={{ textAlign: 'right' }}>PV HT / U</th>
                  <th style={{ textAlign: 'right' }}>Total HT</th>
                  <th />
                </tr></thead>
                <tbody>
                  {clientLines.map(({ line, depth }) => {
                    const item = itemById.get(line.id);
                    if (line.type === 'titre' || line.type === 'sous_titre') {
                      return (
                        <tr key={line.id} style={{ background: 'var(--surface)' }}>
                          <td colSpan={5} style={{ paddingLeft: 8 + depth * 16, fontWeight: 600 }}>
                            {line.code ? <strong>{line.code} </strong> : null}{line.designation}
                          </td>
                        </tr>
                      );
                    }
                    if (line.type === 'texte') {
                      return (
                        <tr key={line.id}><td colSpan={5} style={{ paddingLeft: 8 + depth * 16, fontStyle: 'italic', color: 'var(--muted)' }}>{line.designation}</td></tr>
                      );
                    }
                    const qty = Number(line.quantity) || 0;
                    const puVente = item && qty ? Number(item.pv) / qty : null;
                    return (
                      <tr key={line.id} style={item?.forced ? { background: '#fff7ed' } : undefined}>
                        <td style={{ paddingLeft: 8 + depth * 16 }}>{line.designation}</td>
                        <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                        <td style={{ textAlign: 'right', color: item?.forced ? 'var(--accent)' : undefined, fontWeight: item?.forced ? 600 : undefined }}>
                          {puVente != null ? euro(puVente) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{item ? euro(item.pv) : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {item && (item.forced ? (
                            <button className="btn-ghost" type="button" disabled={setLinePv.isPending}
                              onClick={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })}>Libérer</button>
                          ) : (
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              <input style={{ width: 60, textAlign: 'right' }} placeholder="PU"
                                value={pvEdit[line.id] ?? ''}
                                onChange={(e) => setPvEdit({ ...pvEdit, [line.id]: e.target.value })} />
                              <button className="btn-ghost" type="button" disabled={setLinePv.isPending || !pvEdit[line.id]}
                                onClick={() => setLinePv.mutate({ lineId: line.id, puVente: pvEdit[line.id], force: true })}>Forcer</button>
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Devis vide — construisez-le dans l’onglet Étude de prix.</p>}
          </div>
          )}

            </div>

            <aside className="synthese-panel" data-panel="2">
              {tab === 'client' ? (
                <>
                  <div className="form-section-title">Récapitulatif client</div>
                  <div className="synthese-row"><span className="lbl">PV brut HT</span><span className="val">{euro(sale.data?.pvDevis)}</span></div>
                  <div className="synthese-row">
                    <span className="lbl">Remise</span>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input style={{ width: 56, textAlign: 'right' }} value={remise.valeur}
                        onChange={(e) => setRemise({ ...remise, valeur: e.target.value })} />
                      <button type="button" className="btn-ghost" style={{ fontWeight: 700 }}
                        onClick={() => setRemise({ ...remise, type: remise.type === 'pct' ? 'fixe' : 'pct' })}>
                        {remise.type === 'pct' ? '%' : '€'}
                      </button>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 8px' }}
                        onClick={() => { setErr(null); setSale.mutate(); }} disabled={setSale.isPending}>OK</button>
                    </span>
                  </div>
                  <div className="synthese-row"><span className="lbl">Total HT</span><span className="val">{euro(sale.data?.totalPvHt)}</span></div>
                  <div className="synthese-row"><span className="lbl">TVA</span><span className="val">{euro(sale.data?.tva)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--primary)', color: '#fff', margin: '10px -16px 0', padding: '10px 16px' }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>Total TTC</span>
                    <span style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{euro(sale.data?.totalTtc)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-section-title">Récapitulatif débours</div>
                  {titreRecap.map(({ line, total }, i) => (
                    <div key={line.id} className="synthese-row">
                      <span className="lbl" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--muted)', marginRight: 6 }}>{i + 1}</span>
                        {line.designation}
                      </span>
                      <span className="val" style={{ color: 'var(--accent)' }}>{euro(total)}</span>
                    </div>
                  ))}
                  <div className="synthese-row" style={{ borderTop: '2px solid var(--border)', borderBottom: 'none', marginTop: 4, fontWeight: 700 }}>
                    <span>Total débours HT</span>
                    <span className="val" style={{ color: 'var(--accent)', fontSize: 14 }}>{euro(sale.data?.totalDebourse)}</span>
                  </div>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={exportDebours}>
                    Export Débours
                  </button>
                </>
              )}

              <div className="form-section-title" style={{ marginTop: 18 }}>Synthèse financière</div>
              <div className="synthese-row"><span className="lbl">Déboursé total</span><span className="val">{euro(sale.data?.totalDebourse)}</span></div>
              <div className="synthese-row"><span className="lbl">Frais annexes</span><span className="val">{euro(sale.data?.fraisAnnexes)}</span></div>
              <div className="synthese-row"><span className="lbl">Prix de revient</span><span className="val">{euro(sale.data?.totalRevient)}</span></div>
              <div className="synthese-row"><span className="lbl">PV net</span><span className="val">{euro(sale.data?.totalPvHt)}</span></div>
              <div className="synthese-row">
                <span className="lbl">Marge brute</span>
                <span className="val" style={{ color: 'var(--success)' }}>{euro(sale.data?.margeBrute)}{marginPct(sale.data?.margeBrute, sale.data?.totalPvHt)}</span>
              </div>
              <div className="synthese-row">
                <span className="lbl">Marge nette</span>
                <span className="val" style={{ color: 'var(--success)' }}>{euro(sale.data?.margeNette)}{marginPct(sale.data?.margeNette, sale.data?.totalPvHt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 'var(--radius-sm)', padding: 8, textAlign: 'center' }}>
                  <div className="label" style={{ marginBottom: 2 }}>PV / Débours</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>×{coeffStr(sale.data?.pvHorsFrais, sale.data?.totalDebourse)}</div>
                </div>
                <div style={{ flex: 1, background: '#fff7ed', borderRadius: 'var(--radius-sm)', padding: 8, textAlign: 'center' }}>
                  <div className="label" style={{ marginBottom: 2, color: 'var(--accent)' }}>PV / PR</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>×{coeffStr(sale.data?.pvHorsFrais, sale.data?.totalRevient)}</div>
                </div>
              </div>
              {sale.isError && <p className="muted" style={{ marginTop: 10 }}>Définissez les coefficients pour calculer les totaux.</p>}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}

/** « (X %) » de marge par rapport au PV net, ou '' */
function marginPct(value?: string, base?: string): string {
  const v = Number(value), b = Number(base);
  if (!b) return '';
  return ` (${((v / b) * 100).toFixed(1)} %)`;
}
/** coefficient num/den à 3 décimales, ou '—' */
function coeffStr(num?: string, den?: string): string {
  const n = Number(num), d = Number(den);
  if (!d) return '—';
  return (n / d).toFixed(3);
}
