'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';
import { usePreferences, fmtEuro, fmtNum } from '@/lib/preferences';
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
  numero?: string | null;
  num_custom?: string | null;
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
interface ApproRow {
  code: string | null; designation: string; uniteEmploi: string | null; qteEmploi: string;
  uniteAchat: string | null; coeffConversion: string | null; conditionnement: string | null;
  fournisseur: string | null; refFournisseur: string | null; prixPublic: string | null;
  qteAppro: string; montant: string;
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
  const prefs = usePreferences();
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
  // TVA : initialisée à '20' puis mise à jour par useEffect quand les prefs chargent
  const [tva, setTva] = useState('20');
  const tvaPrefsApplied = useRef(false);
  useEffect(() => {
    if (tvaPrefsApplied.current || !prefs.id || prefs.taux_tva.length === 0) return;
    tvaPrefsApplied.current = true;
    // Dernier taux non-zéro (souvent 20%), sinon 20
    const def = prefs.taux_tva.filter(t => t > 0).slice(-1)[0] ?? 20;
    setTva(String(def));
  }, [prefs.id, prefs.taux_tva]);
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

  // PV (prix de vente) agrégé par titre racine — pour les sous-totaux de l'aperçu devis.
  const titrePvByRoot = useMemo(() => {
    const byId = new Map((lines.data ?? []).map((l) => [l.id, l]));
    const rootOf = (id: string) => {
      let cur = byId.get(id);
      while (cur && cur.parent_line_id) cur = byId.get(cur.parent_line_id);
      return cur;
    };
    const totals = new Map<string, number>();
    for (const it of sale.data?.items ?? []) {
      const root = rootOf(it.id);
      if (root) totals.set(root.id, (totals.get(root.id) ?? 0) + Number(it.pv));
    }
    return totals;
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

  // Calcul Appro (modal)
  const [approOpen, setApproOpen] = useState(false);
  const appro = useQuery({
    queryKey: ['appro', versionId],
    enabled: Boolean(token && versionId && approOpen),
    queryFn: () => apiFetch<ApproRow[]>(`/versions/${versionId}/appro`, { token }),
  });
  function exportAppro() {
    const rows: (string | number)[][] = [['Code', 'Désignation', 'Qté emploi', 'Unité achat', 'Coeff', 'Qté appro', 'Prix public', 'Montant HT', 'Fournisseur']];
    for (const r of appro.data ?? []) rows.push([r.code ?? '', r.designation, r.qteEmploi, r.uniteAchat ?? '', r.coeffConversion ?? '', r.qteAppro, r.prixPublic ?? '', r.montant, r.fournisseur ?? '']);
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appro_${d?.numero || devisId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Préremplit le formulaire avec la config stockée (une fois par version chargée).
  // Si le devis n'est pas encore configuré → pré-remplir avec les préférences société.
  const cfgInit = useRef<string | null>(null);
  useEffect(() => {
    const cfg = saleConfig.data;
    if (!cfg || !versionId || cfgInit.current === versionId) return;
    cfgInit.current = versionId;
    if (cfg.configured && cfg.byNature) {
      // Devis déjà configuré : charger les valeurs stockées
      const b = cfg.byNature;
      setCoef({
        labor: { fg: b.labor.tauxFg, ben: b.labor.tauxBenefice },
        material: { fg: b.material.tauxFg, ben: b.material.tauxBenefice },
        equipment: { fg: b.equipment.tauxFg, ben: b.equipment.tauxBenefice },
        subcontract: { fg: b.subcontract.tauxFg, ben: b.subcontract.tauxBenefice },
      });
      if (cfg.remise) setRemise({ type: cfg.remise.type, valeur: String(Number(cfg.remise.valeur)) });
      if (cfg.tvaRate) setTva(String(Number(cfg.tvaRate) * 100)); // fraction → %
    } else {
      // Nouveau devis non configuré → pré-remplir avec les préférences société
      const fg = String(Number(prefs.taux_fg_default) || 25);
      const ben = String(Number(prefs.taux_ben_default) || 15);
      setCoef({
        labor: { fg, ben },
        material: { fg, ben },
        equipment: { fg, ben },
        subcontract: { fg, ben },
      });
    }
    setFrais((cfg.fraisAnnexes ?? []).map((f) => ({
      designation: f.designation, type: f.type, valeur: String(Number(f.valeur)),
    })));
  }, [saleConfig.data, versionId, prefs.taux_fg_default, prefs.taux_ben_default]);

  async function downloadPdf() {
    if (!versionId) return;
    setPdfError(null);
    try { window.open(await apiFetchBlobUrl(`/versions/${versionId}/devis.pdf`, token), '_blank'); }
    catch { setPdfError('PDF indisponible.'); }
  }

  // Alias formatage avec nb_decimales des préférences
  const e = (v: string | number | null | undefined) => fmtEuro(v, prefs.nb_decimales);

  const d = detail.data?.devis;

  // Onglet par défaut depuis les préférences.
  // useState seul ne suffit pas (les prefs chargent après le mount) → useEffect avec ref.
  const [tab, setTab] = useState<'etude' | 'coeffs' | 'client' | 'apercu'>('etude');
  const tabPrefsApplied = useRef(false);
  useEffect(() => {
    // S'applique une seule fois, dès que les prefs réelles sont chargées (prefs.id présent)
    // Ne s'applique pas si l'utilisateur a déjà changé d'onglet manuellement.
    if (tabPrefsApplied.current || !prefs.id) return;
    tabPrefsApplied.current = true;
    const mapped: 'etude' | 'coeffs' | 'client' | 'apercu' =
      prefs.default_tab === 'coefficients' ? 'coeffs'
      : prefs.default_tab === 'client' ? 'client'
      : prefs.default_tab === 'pdf' ? 'apercu'
      : 'etude'; // autres → étude par défaut
    setTab(mapped);
  }, [prefs.id, prefs.default_tab]);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/estimating/devis" className="link">← Devis</Link>
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
            {([['etude', 'Étude de prix'], ['coeffs', 'Coefficients & frais'], ['client', 'Devis client'], ['apercu', 'Aperçu devis']] as const).map(([key, label]) => (
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
              Construisez le devis sur place : chaque titre propose « + Ligne / Bibliothèque / Texte libre / + Sous-niveau X ». Les ouvrages copient leur sous-détail (éditable). « V » = variante, « O » = option (hors total).
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
                <Field label="TVA">
                  <select className="input" style={{ width: 120 }} value={tva} onChange={(e) => setTva(e.target.value)}>
                    {prefs.taux_tva.map((t) => (
                      <option key={t} value={String(t)}>
                        {t === 0 ? 'Autoliquidée (0%)' : `${t}%`}
                      </option>
                    ))}
                  </select>
                </Field>
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
                {sale.data && <span className="muted" style={{ marginLeft: 12 }}>Total frais appliqué : {e(sale.data.fraisAnnexes)}</span>}
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
                </tr></thead>
                <tbody>
                  {clientLines.map(({ line, depth }) => {
                    const item = itemById.get(line.id);
                    if (line.type === 'titre' || line.type === 'sous_titre') {
                      return (
                        <tr key={line.id} style={{ background: 'var(--surface)' }}>
                          <td colSpan={4} style={{ paddingLeft: 8 + depth * 16, fontWeight: 600 }}>
                            <span style={{ fontFamily: 'monospace', color: 'var(--accent)', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
                            {line.code ? <strong>{line.code} </strong> : null}{line.designation}
                          </td>
                        </tr>
                      );
                    }
                    if (line.type === 'texte') {
                      return (
                        <tr key={line.id}><td colSpan={4} style={{ paddingLeft: 8 + depth * 16, fontStyle: 'italic', color: 'var(--muted)' }}>{line.designation}</td></tr>
                      );
                    }
                    const qty = Number(line.quantity) || 0;
                    const puVente = item && qty ? Number(item.pv) / qty : null;
                    return (
                      <tr key={line.id} style={item?.forced ? { background: '#fff7ed' } : undefined}>
                        <td style={{ paddingLeft: 8 + depth * 16 }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--accent)', marginRight: 8, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
                          {line.designation}
                        </td>
                        <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>
                          {item ? (
                            <PvCell
                              computed={puVente}
                              forced={!!item.forced}
                              pending={setLinePv.isPending}
                              decimals={prefs.nb_decimales}
                              onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
                              onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })}
                            />
                          ) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{item ? e(item.pv) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Devis vide — construisez-le dans l’onglet Étude de prix.</p>}
          </div>
          )}

          {tab === 'apercu' && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Aperçu du devis</h2>
              <button className="btn-secondary" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>Rendu du document tel qu’il sera remis au client (indépendant de l’export PDF).</p>
            {pdfError && <p className="muted">{pdfError}</p>}
            {clientLines.length > 0 ? (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '28px 32px', maxWidth: 820, margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--primary)', paddingBottom: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>DEVIS</div>
                    {d?.numero && <div style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>N° {d.numero}</div>}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
                    {latest ? <div>Version {latest.version_no}</div> : null}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{d?.designation}</div>
                <table className="grid" style={{ width: '100%' }}>
                  <thead><tr>
                    <th style={{ width: 70 }}>N°</th>
                    <th>Désignation</th>
                    <th style={{ textAlign: 'right' }}>Qté</th>
                    <th style={{ textAlign: 'right' }}>PU HT</th>
                    <th style={{ textAlign: 'right' }}>Total HT</th>
                  </tr></thead>
                  <tbody>
                    {clientLines.map(({ line, depth }) => {
                      const item = itemById.get(line.id);
                      if (line.type === 'titre' || line.type === 'sous_titre') {
                        const sub = line.type === 'titre' ? titrePvByRoot.get(line.id) : undefined;
                        return (
                          <tr key={line.id} style={{ background: 'var(--surface)' }}>
                            <td style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{line.numero ?? ''}</td>
                            <td colSpan={3} style={{ paddingLeft: depth * 16, fontWeight: 600, textTransform: line.type === 'titre' ? 'uppercase' : 'none', color: line.type === 'titre' ? 'var(--primary)' : undefined }}>
                              {line.code ? <strong>{line.code} </strong> : null}{line.designation}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{sub != null ? e(sub) : ''}</td>
                          </tr>
                        );
                      }
                      if (line.type === 'texte') {
                        return <tr key={line.id}><td /><td colSpan={4} style={{ paddingLeft: depth * 16, fontStyle: 'italic', color: 'var(--muted)' }}>{line.designation}</td></tr>;
                      }
                      const qty = Number(line.quantity) || 0;
                      const puVente = item && qty ? Number(item.pv) / qty : null;
                      return (
                        <tr key={line.id}>
                          <td style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: 11 }}>{line.numero ?? ''}</td>
                          <td style={{ paddingLeft: depth * 16 }}>{line.designation}</td>
                          <td style={{ textAlign: 'right' }}>{line.quantity ?? '—'} {line.unit ?? ''}</td>
                          <td style={{ textAlign: 'right' }}>{puVente != null ? e(puVente) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{item ? e(item.pv) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <div style={{ width: 300 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">PV brut HT</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(sale.data?.pvDevis)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">Remise</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e((Number(sale.data?.pvDevis) || 0) - (Number(sale.data?.totalPvHt) || 0))}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)', fontWeight: 600 }}><span>Total HT</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(sale.data?.totalPvHt)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">TVA</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(sale.data?.tva)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', marginTop: 4, background: 'var(--primary)', color: '#fff', borderRadius: 'var(--radius-sm)', fontWeight: 700 }}><span>Total TTC</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(sale.data?.totalTtc)}</span></div>
                  </div>
                </div>
              </div>
            ) : <p className="muted">Devis vide — construisez-le dans l’onglet Étude de prix.</p>}
          </div>
          )}

            </div>

            <aside className="synthese-panel" data-panel="2">
              {tab === 'client' ? (
                <>
                  <div className="form-section-title">Récapitulatif client</div>
                  <div className="synthese-row"><span className="lbl">PV brut HT</span><span className="val">{e(sale.data?.pvDevis)}</span></div>
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
                  <div className="synthese-row"><span className="lbl">Total HT</span><span className="val">{e(sale.data?.totalPvHt)}</span></div>
                  <div className="synthese-row"><span className="lbl">TVA</span><span className="val">{e(sale.data?.tva)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--primary)', color: '#fff', margin: '10px -16px 0', padding: '10px 16px' }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>Total TTC</span>
                    <span style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{e(sale.data?.totalTtc)}</span>
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
                      <span className="val" style={{ color: 'var(--accent)' }}>{e(total)}</span>
                    </div>
                  ))}
                  <div className="synthese-row" style={{ borderTop: '2px solid var(--border)', borderBottom: 'none', marginTop: 4, fontWeight: 700 }}>
                    <span>Total débours HT</span>
                    <span className="val" style={{ color: 'var(--accent)', fontSize: 14 }}>{e(sale.data?.totalDebourse)}</span>
                  </div>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={exportDebours}>
                    Export Débours
                  </button>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => setApproOpen(true)}>
                    Calcul Appro
                  </button>
                </>
              )}

              <div className="form-section-title" style={{ marginTop: 18 }}>Synthèse financière</div>
              <div className="synthese-row"><span className="lbl">Déboursé total</span><span className="val">{e(sale.data?.totalDebourse)}</span></div>
              <div className="synthese-row"><span className="lbl">Frais annexes</span><span className="val">{e(sale.data?.fraisAnnexes)}</span></div>
              <div className="synthese-row"><span className="lbl">Prix de revient</span><span className="val">{e(sale.data?.totalRevient)}</span></div>
              <div className="synthese-row"><span className="lbl">PV net</span><span className="val">{e(sale.data?.totalPvHt)}</span></div>
              <div className="synthese-row">
                <span className="lbl">Marge brute</span>
                <span className="val" style={{ color: 'var(--success)' }}>{e(sale.data?.margeBrute)}{marginPct(sale.data?.margeBrute, sale.data?.totalPvHt)}</span>
              </div>
              <div className="synthese-row">
                <span className="lbl">Marge nette</span>
                <span className="val" style={{ color: 'var(--success)' }}>{e(sale.data?.margeNette)}{marginPct(sale.data?.margeNette, sale.data?.totalPvHt)}</span>
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

      {approOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setApproOpen(false)}
        >
          <div className="card" style={{ width: 'min(920px, 96vw)', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Calcul approvisionnement</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={exportAppro} disabled={!appro.data?.length}>Export CSV</button>
                <button className="btn-ghost" onClick={() => setApproOpen(false)}>✕</button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>Quantités d’achat par ressource (quantité d’emploi ÷ coefficient de conversion).</p>
            {appro.isLoading ? <p className="muted">Calcul…</p> : appro.data?.length ? (
              <table className="grid" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Code</th><th>Désignation</th>
                  <th style={{ textAlign: 'right' }}>Qté emploi</th>
                  <th>U. achat</th>
                  <th style={{ textAlign: 'right' }}>Coeff</th>
                  <th style={{ textAlign: 'right' }}>Qté appro</th>
                  <th style={{ textAlign: 'right' }}>Montant HT</th>
                  <th>Fournisseur</th>
                </tr></thead>
                <tbody>
                  {appro.data.map((r, i) => (
                    <tr key={i}>
                      <td className="code-cell">{r.code ?? '—'}</td>
                      <td>{r.designation}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.qteEmploi).toLocaleString('fr-FR')} {r.uniteEmploi}</td>
                      <td>{r.uniteAchat ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.coeffConversion ? Number(r.coeffConversion) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(r.qteAppro).toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{e(r.montant)}</td>
                      <td className="muted">{r.fournisseur ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Aucune ressource de bibliothèque dans ce devis (le calcul appro porte sur les ressources issues de la bibliothèque).</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}

/**
 * Prix de vente unitaire éditable en place (onglet Devis client).
 * Saisir une valeur force le prix (champ surligné orange + cadenas pour libérer) ;
 * le cadenas rétablit le prix calculé. Pas de champ « Forcer » séparé.
 */
function PvCell({ computed, forced, pending, decimals, onForce, onRelease }: {
  computed: number | null;
  forced: boolean;
  pending: boolean;
  decimals: number;
  onForce: (v: string) => void;
  onRelease: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused ? draft : (computed != null ? fmtNum(computed, decimals) : '');
  const commit = () => {
    setFocused(false);
    const cleaned = draft.replace(',', '.').replace(/[^0-9.]/g, '');
    if (cleaned === '') return; // vide → aucun changement
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    // Ne pas forcer si la valeur saisie égale le calcul (évite un forçage inutile).
    if (!forced && computed != null && Math.abs(n - computed) < 1e-6) return;
    onForce(cleaned);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <input
        style={{
          width: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          ...(forced ? { borderColor: 'var(--accent)', background: '#fff7ed', color: 'var(--accent)', fontWeight: 600 } : {}),
        }}
        value={shown}
        disabled={pending}
        onFocus={() => { setFocused(true); setDraft(computed != null ? String(Number(computed.toFixed(decimals))) : ''); }}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); } }}
      />
      {forced && (
        <button type="button" className="btn-ghost" title="Libérer le prix forcé (revenir au prix calculé)"
          disabled={pending} onClick={onRelease} style={{ padding: '2px 6px', color: 'var(--accent)', lineHeight: 1 }}>🔒</button>
      )}
    </span>
  );
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
