'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';
import { usePreferences, fmtEuro, cleanNum } from '@/lib/preferences';
import { downloadXlsx } from '@/lib/xlsx';
import { useWorkspace } from '@/lib/workspace';
import { Montage, MontageLine } from './Montage';
import { LibraryDrawer } from './LibraryDrawer';
import { WorkflowBar } from './WorkflowBar';

const round = (v: number, n: number) => Number((Number(v) || 0).toFixed(n));

interface Version { id: string; version_no: number; label: string }
interface DevisDetail {
  devis: { id: string; numero: string | null; designation: string; type: string; status: string };
  versions: Version[];
}
interface DevisLine {
  id: string; parent_line_id: string | null; type: string; code: string | null;
  code_analytique: string | null; designation: string; unit: string | null;
  quantity: string | null; pu: string | null; perte: string | null;
  pu_vente: string | null; pu_vente_force: boolean;
  section_type: 'option' | 'variante' | null; source_ouvrage_id: string | null;
  sort_order: number; numero?: string | null; num_custom?: string | null;
}
interface SaleItem {
  id: string; debourse: string; revient: string; pvComputed: string; pv: string;
  forced: boolean; margeBrute: string; margeNette: string; ventilatedFrais: string;
}
interface SaleSheet {
  items: SaleItem[]; totalDebourse: string; totalRevient: string; pvHorsFrais: string;
  fraisAnnexes: string; pvDevis: string; remise: string; totalPvHt: string;
  margeBrute: string; margeNette: string; coeffGlobalReel: string; tva: string; totalTtc: string;
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

function marginPct(value?: string, base?: string): string {
  const v = Number(value), b = Number(base);
  if (!b) return '';
  return ` (${((v / b) * 100).toFixed(1)} %)`;
}
function coeffStr(num?: string, den?: string): string {
  const n = Number(num), d = Number(den);
  if (!d) return '—';
  return (n / d).toFixed(3);
}

export interface DevisEditorContentProps {
  affaireId: string;
  devisId: string;
  isPanel2?: boolean;
}

export function DevisEditorContent({ affaireId, devisId, isPanel2 = false }: DevisEditorContentProps) {
  const { token } = useAuth();
  const prefs = usePreferences();
  const qc = useQueryClient();
  const router = useRouter();
  const workspace = useWorkspace();
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['devis', devisId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisDetail>(`/devis/${devisId}`, { token }),
  });
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const versions = detail.data?.versions ?? [];
  const latest = versions[versions.length - 1];
  const versionId = activeVersionId ?? latest?.id;
  const isLatest = !activeVersionId || activeVersionId === latest?.id;

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
  const affaireDetail = useQuery<{
    affaire: { id: string; code: string; name: string };
    devis: Array<{ id: string; numero: string | null; designation: string; versions: Version[] }>
  }>({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch(`/affaires/${affaireId}`, { token }),
  });

  const [changingAffaire, setChangingAffaire] = useState(false);
  const allAffaires = useQuery<{ rows: { id: string; code: string; name: string }[] }>({
    queryKey: ['affaires-picker'],
    enabled: changingAffaire && Boolean(token) && !isPanel2,
    queryFn: () => apiFetch('/affaires?sort=code&pageSize=200', { token }),
  });
  const moveAffaireMut = useMutation({
    mutationFn: (newAffaireId: string) =>
      apiFetch(`/devis/${devisId}`, { token, method: 'PATCH', body: { affaire_id: newAffaireId } }),
    onSuccess: (_, newAffaireId) => {
      setChangingAffaire(false);
      if (!isPanel2) router.push(`/estimating/${newAffaireId}/devis/${devisId}`);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const ordered = useMemo(() => orderTree(lines.data ?? []), [lines.data]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['lines', versionId] });
    qc.invalidateQueries({ queryKey: ['sale-sheet', versionId] });
    qc.invalidateQueries({ queryKey: ['sale-config', versionId] });
  }

  const [coef, setCoef] = useState<Record<Nat, { fg: string; ben: string }>>({
    labor: { fg: '10', ben: '15' }, material: { fg: '8', ben: '10' },
    equipment: { fg: '10', ben: '10' }, subcontract: { fg: '5', ben: '5' },
  });
  const [remise, setRemise] = useState<{ type: 'pct' | 'fixe'; valeur: string }>({ type: 'pct', valeur: '0' });
  const [tva, setTva] = useState('20');
  const tvaPrefsApplied = useRef(false);
  useEffect(() => {
    if (tvaPrefsApplied.current || !prefs.id || prefs.taux_tva.length === 0) return;
    tvaPrefsApplied.current = true;
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
          tvaRate: String((Number(tva) || 0) / 100),
        },
        token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const createVersionMut = useMutation({
    mutationFn: () => apiFetch<Version>(`/devis/${devisId}/versions`, { method: 'POST', body: { label: '' }, token }),
    onSuccess: () => {
      setActiveVersionId(null);
      qc.invalidateQueries({ queryKey: ['devis', devisId] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

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

  const itemById = useMemo(
    () => new Map((sale.data?.items ?? []).map((i) => [i.id, i])),
    [sale.data],
  );
  const saleById = useMemo(
    () => new Map((sale.data?.items ?? []).map((i) => [i.id, { pv: i.pv, forced: i.forced }])),
    [sale.data],
  );
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

  const lineById = useMemo(
    () => new Map((lines.data ?? []).map((l) => [l.id, l])),
    [lines.data],
  );

  const apercuLinesWithSection = useMemo(
    () => clientLines.map((o) => {
      let cur: DevisLine | undefined = o.line;
      let sect: 'option' | 'variante' | null = null;
      while (cur) {
        if (cur.section_type) { sect = cur.section_type; break; }
        cur = cur.parent_line_id ? lineById.get(cur.parent_line_id) : undefined;
      }
      return { ...o, sect };
    }),
    [clientLines, lineById],
  );

  const apercuTotals = useMemo(() => {
    let base = 0, option = 0, variante = 0;
    for (const it of sale.data?.items ?? []) {
      const line = lineById.get(it.id);
      if (!line) continue;
      let cur: DevisLine | undefined = line;
      let sect: 'option' | 'variante' | null = null;
      while (cur) {
        if (cur.section_type) { sect = cur.section_type; break; }
        cur = cur.parent_line_id ? lineById.get(cur.parent_line_id) : undefined;
      }
      const pv = Number(it.pv) || 0;
      if (sect === 'option') option += pv;
      else if (sect === 'variante') variante += pv;
      else base += pv;
    }
    return { base, option, variante };
  }, [sale.data, lineById]);

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
    for (const r of agg.values()) rows.push([r.code, r.designation, round(r.qty, 3), round(r.pu, 4), round(r.montant, 2)]);
    downloadXlsx(`debours_${d?.numero || devisId}`, rows, 'Déboursé');
  }

  const [approOpen, setApproOpen] = useState(false);
  const appro = useQuery({
    queryKey: ['appro', versionId],
    enabled: Boolean(token && versionId && approOpen),
    queryFn: () => apiFetch<ApproRow[]>(`/versions/${versionId}/appro`, { token }),
  });
  function exportAppro() {
    const num = (v: unknown) => (v == null || v === '' ? '' : Number(v));
    const rows: (string | number)[][] = [['Code', 'Désignation', 'Qté emploi', 'Unité achat', 'Coeff', 'Qté appro', 'Prix public', 'Montant HT', 'Fournisseur']];
    for (const r of appro.data ?? []) rows.push([r.code ?? '', r.designation, num(r.qteEmploi), r.uniteAchat ?? '', num(r.coeffConversion), num(r.qteAppro), num(r.prixPublic), num(r.montant), r.fournisseur ?? '']);
    downloadXlsx(`appro_${d?.numero || devisId}`, rows, 'Appro');
  }

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
      if (cfg.tvaRate) setTva(String(Number(cfg.tvaRate) * 100));
    } else {
      const fg = String(Number(prefs.taux_fg_default) || 25);
      const ben = String(Number(prefs.taux_ben_default) || 15);
      setCoef({ labor: { fg, ben }, material: { fg, ben }, equipment: { fg, ben }, subcontract: { fg, ben } });
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

  const e = (v: string | number | null | undefined) => fmtEuro(v, prefs.nb_decimales);
  const d = detail.data?.devis;

  const [tab, setTab] = useState<'etude' | 'coeffs' | 'client' | 'apercu'>('etude');
  const tabPrefsApplied = useRef(false);
  useEffect(() => {
    if (tabPrefsApplied.current || !prefs.id) return;
    tabPrefsApplied.current = true;
    const mapped: 'etude' | 'coeffs' | 'client' | 'apercu' =
      prefs.default_tab === 'coefficients' ? 'coeffs'
      : prefs.default_tab === 'client' ? 'client'
      : prefs.default_tab === 'pdf' ? 'apercu'
      : 'etude';
    setTab(mapped);
  }, [prefs.id, prefs.default_tab]);

  const isSplitOpen = workspace.splitOpen;

  return (
    <div style={{ minHeight: '100%' }}>
      {!isPanel2 && (
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href="/estimating/devis" className="link">← Devis</Link>
        </p>
      )}
      {detail.isError && <p className="muted">Devis introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {d && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <h1 style={{ margin: 0 }}>{d.numero ? `${d.numero} — ` : ''}{d.designation}</h1>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, paddingTop: 4 }}>
              {versions.map((v) => {
                const active = versionId === v.id;
                return (
                  <button key={v.id} type="button"
                    onClick={() => setActiveVersionId(v.id === latest?.id ? null : v.id)}
                    title={v.label || `Version ${v.version_no}`}
                    style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 12, cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                      background: active ? 'var(--primary)' : 'transparent',
                      color: active ? '#fff' : 'var(--muted)', fontWeight: active ? 700 : 400,
                    }}
                  >v{v.version_no}</button>
                );
              })}
              <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '2px 10px' }}
                onClick={() => { setErr(null); createVersionMut.mutate(); }}
                disabled={createVersionMut.isPending || !isLatest}
                title="Créer une nouvelle révision"
              >+ Révision</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 0, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className={d.status === 'won' ? 'badge success' : d.status === 'lost' ? 'badge danger' : (d.status === 'sent' || d.status === 'coeffs_validated') ? 'badge info' : 'badge'}>
              {AFFAIRE_STATUS_LABELS[d.status] ?? d.status}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>{d.type}</span>
            <span style={{ color: 'var(--border)', fontSize: 11 }}>·</span>
            {!isPanel2 && !changingAffaire ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Link href={`/estimating/${affaireId}`} style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                  {affaireDetail.data?.affaire?.code ?? affaireId}
                </Link>
                {affaireDetail.data?.affaire?.name && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>— {affaireDetail.data.affaire.name}</span>
                )}
                <button type="button" title="Changer d'affaire" onClick={() => setChangingAffaire(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '1px 4px', borderRadius: 4, fontSize: 11 }}>✎</button>
              </span>
            ) : !isPanel2 && changingAffaire ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <select autoFocus defaultValue={affaireId} disabled={moveAffaireMut.isPending}
                  onChange={(ev) => { if (ev.target.value && ev.target.value !== affaireId) moveAffaireMut.mutate(ev.target.value); }}
                  style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-strong)' }}>
                  <option value={affaireId}>
                    {affaireDetail.data?.affaire ? `${affaireDetail.data.affaire.code} — ${affaireDetail.data.affaire.name}` : affaireId}
                  </option>
                  {(allAffaires.data?.rows ?? []).filter((a) => a.id !== affaireId).map((a) =>
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  )}
                </select>
                <button type="button" onClick={() => setChangingAffaire(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>✕</button>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                  {affaireDetail.data?.affaire?.code ?? affaireId}
                </span>
                {affaireDetail.data?.affaire?.name && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>— {affaireDetail.data.affaire.name}</span>
                )}
              </span>
            )}
          </div>

          {!isPanel2 && (
            <WorkflowBar
              devisId={devisId}
              status={d.status}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: ['devis', devisId] });
                qc.invalidateQueries({ queryKey: ['affaire', affaireId] });
              }}
            />
          )}

          {!isLatest && (
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 14px', marginBottom: 8, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔒</span>
              <span>
                Version {versions.find((v) => v.id === versionId)?.version_no} — lecture seule.
                {' '}<button type="button" className="link" onClick={() => setActiveVersionId(null)} style={{ fontSize: 13 }}>Revenir à la v{latest?.version_no}</button> pour modifier.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12, borderBottom: '1px solid var(--border)' }}>
            {([['etude', 'Étude de prix'], ['coeffs', 'Coefficients & frais'], ['client', 'Devis client'], ['apercu', 'Aperçu devis']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className="editor-tab"
                style={{
                  borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
                  fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--primary)' : 'var(--muted)',
                }}>
                {label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {(tab === 'etude' || tab === 'client') && (
              <>
                {!isPanel2 && (
                  <button type="button"
                    onClick={() => {
                      if (isSplitOpen) workspace.closePanel2();
                      else { workspace.openSplit(); workspace.selectPanel2(null, affaireId); }
                    }}
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '3px 10px', marginBottom: 2, background: isSplitOpen ? 'var(--primary)' : undefined, color: isSplitOpen ? '#fff' : undefined }}>
                    ⧉ Comparer
                  </button>
                )}
                <button type="button" onClick={() => setLibraryOpen((v) => !v)} className="btn-secondary"
                  style={{ fontSize: 11, padding: '3px 10px', marginBottom: 2, background: libraryOpen ? 'var(--primary)' : undefined, color: libraryOpen ? '#fff' : undefined }}>
                  ⊟ Bibliothèque
                </button>
              </>
            )}
          </div>

          <div className={`editor-grid${libraryOpen ? ' library-open' : ''}${workspace.splitOpen ? ' split-active' : ''}`}>
            <div className="editor-main" data-panel="1">

              {tab === 'etude' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h2 style={{ margin: 0 }}>Corps du devis</h2>
                  <p className="muted" style={{ marginTop: 4 }}>
                    Construisez le devis sur place : le bouton « + » ouvre un menu (Ligne / Ressources / Texte libre / Sous-niveau X). Les ouvrages copient leur sous-détail, modifiable ici sans impacter la bibliothèque société. « V » = variante, « O » = option (hors total).
                  </p>
                  <Montage
                    versionId={versionId!}
                    token={token}
                    lines={(lines.data ?? []) as MontageLine[]}
                    deboursById={new Map((sale.data?.items ?? []).map((i) => [i.id, i.debourse]))}
                    decimals={prefs.nb_decimales}
                    onChanged={refresh}
                    readOnly={!isLatest}
                    acceptDrop={libraryOpen}
                  />
                </div>
              )}

              {tab === 'coeffs' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h2>Feuille de vente — coefficients par nature</h2>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Déboursé × (1 + FG %) = prix de revient, puis × (1 + Bénéfice %) = prix de vente.
                  </p>
                  <form onSubmit={(ev) => { ev.preventDefault(); setErr(null); setSale.mutate(); }}>
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
                                  onChange={(ev) => setCoef({ ...coef, [n]: { ...c, fg: ev.target.value } })} />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <input style={{ width: 64, textAlign: 'right' }} value={c.ben}
                                  onChange={(ev) => setCoef({ ...coef, [n]: { ...c, ben: ev.target.value } })} />
                              </td>
                              <td style={{ textAlign: 'right' }} className="muted">{k.toFixed(3)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>TVA</label>
                        <select className="input" style={{ width: 120 }} value={tva} onChange={(ev) => setTva(ev.target.value)} disabled={!isLatest}>
                          {prefs.taux_tva.map((t) => (
                            <option key={t} value={String(t)}>{t === 0 ? 'Autoliquidée (0%)' : `${t}%`}</option>
                          ))}
                        </select>
                      </div>
                      <button className="btn" type="submit" disabled={setSale.isPending || !isLatest}>Appliquer</button>
                    </div>
                  </form>
                </div>
              )}

              {tab === 'coeffs' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0 }}>Frais annexes</h2>
                    <button className="btn" type="button" disabled={!isLatest} onClick={() => setFrais([...frais, { designation: '', type: 'pct', valeur: '0' }])}>+ Poste</button>
                  </div>
                  {frais.length === 0 ? (
                    <p className="muted">Aucun poste. Ex : compte prorata (% du PV) ou installation de chantier (montant fixe).</p>
                  ) : (
                    <form onSubmit={(ev) => { ev.preventDefault(); setErr(null); setFraisAnnexes.mutate(); }}>
                      <table className="grid" style={{ marginBottom: 12 }}>
                        <thead><tr><th>Désignation</th><th>Type</th><th style={{ textAlign: 'right' }}>Valeur</th><th /></tr></thead>
                        <tbody>
                          {frais.map((f, i) => (
                            <tr key={i}>
                              <td><input style={{ width: '100%' }} value={f.designation}
                                onChange={(ev) => setFrais(frais.map((x, j) => j === i ? { ...x, designation: ev.target.value } : x))} /></td>
                              <td>
                                <select value={f.type} onChange={(ev) => setFrais(frais.map((x, j) => j === i ? { ...x, type: ev.target.value as 'pct' | 'fixe' } : x))}>
                                  <option value="pct">% du PV</option><option value="fixe">Fixe</option>
                                </select>
                              </td>
                              <td style={{ textAlign: 'right' }}><input style={{ width: 80, textAlign: 'right' }} value={f.valeur}
                                onChange={(ev) => setFrais(frais.map((x, j) => j === i ? { ...x, valeur: ev.target.value } : x))} /></td>
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
                    <h2 style={{ margin: 0 }}>Devis client — prix de vente</h2>
                    <button className="btn-secondary" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
                  </div>
                  <p className="muted" style={{ marginTop: 2 }}>
                    Montez le devis et fixez les prix de vente par ligne. Saisir un prix le force (champ orange + cadenas pour libérer) ; le sous-détail de débours n&apos;est pas affiché ici.
                  </p>
                  <Montage
                    versionId={versionId!}
                    token={token}
                    lines={(lines.data ?? []) as MontageLine[]}
                    deboursById={new Map((sale.data?.items ?? []).map((i) => [i.id, i.debourse]))}
                    mode="vente"
                    saleById={saleById}
                    decimals={prefs.nb_decimales}
                    onChanged={refresh}
                    readOnly={!isLatest}
                    acceptDrop={libraryOpen}
                  />
                </div>
              )}

              {tab === 'apercu' && (() => {
                const hasVariante = apercuTotals.variante > 0.001;
                const hasOption = apercuTotals.option > 0.001;
                const pvDevisN = Number(sale.data?.pvDevis) || 0;
                const totalPvHtN = Number(sale.data?.totalPvHt) || 0;
                const tvaTotal = Number(sale.data?.tva) || 0;
                const remiseFraction = pvDevisN > 0 ? totalPvHtN / pvDevisN : 1;
                const tvaRate = totalPvHtN > 0 ? tvaTotal / totalPvHtN : 0;
                const basePvBrut = apercuTotals.base;
                const baseTotalHt = basePvBrut * remiseFraction;
                const baseRemise = basePvBrut - baseTotalHt;
                const baseTva = baseTotalHt * tvaRate;
                const baseTtc = baseTotalHt + baseTva;

                const apercuRow = (line: DevisLine, depth: number, sect: 'option' | 'variante' | null) => {
                  const item = itemById.get(line.id);
                  const rowBg = sect === 'variante' ? '#fff8f3' : sect === 'option' ? '#fbf5ff' : undefined;
                  const badge = sect ? (
                    <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 700, lineHeight: '14px',
                      background: sect === 'variante' ? '#f97316' : '#a855f7', color: '#fff',
                      borderRadius: 2, padding: '0 4px', marginRight: 5, verticalAlign: 'middle' }}>
                      {sect === 'variante' ? 'V' : 'O'}
                    </span>
                  ) : null;
                  if (line.type === 'titre' || line.type === 'sous_titre') {
                    const sub = line.type === 'titre' ? titrePvByRoot.get(line.id) : undefined;
                    return (
                      <tr key={line.id} style={{ background: rowBg ?? 'var(--surface)' }}>
                        <td style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{line.numero ?? ''}</td>
                        <td colSpan={3} style={{ paddingLeft: depth * 16, fontWeight: 600, textTransform: line.type === 'titre' ? 'uppercase' : 'none', color: line.type === 'titre' ? 'var(--primary)' : undefined }}>
                          {badge}{line.code ? <strong>{line.code} </strong> : null}{line.designation}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{sub != null ? e(sub) : ''}</td>
                      </tr>
                    );
                  }
                  if (line.type === 'texte') {
                    return <tr key={line.id} style={{ background: rowBg }}><td /><td colSpan={4} style={{ paddingLeft: depth * 16, fontStyle: 'italic', color: 'var(--muted)' }}>{badge}{line.designation}</td></tr>;
                  }
                  const qty = Number(line.quantity) || 0;
                  const puVente = item && qty ? Number(item.pv) / qty : null;
                  return (
                    <tr key={line.id} style={{ background: rowBg }}>
                      <td style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: 11 }}>{line.numero ?? ''}</td>
                      <td style={{ paddingLeft: depth * 16 }}>{badge}{line.designation}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity != null ? cleanNum(line.quantity) : '—'} {line.unit ?? ''}</td>
                      <td style={{ textAlign: 'right' }}>{puVente != null ? e(puVente) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{item ? e(item.pv) : '—'}</td>
                    </tr>
                  );
                };

                return (
                  <div className="card" style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h2 style={{ margin: 0 }}>Aperçu du devis</h2>
                      <button className="btn-secondary" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
                    </div>
                    <p className="muted" style={{ marginTop: 0 }}>Rendu du document tel qu&apos;il sera remis au client.</p>
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
                            <th style={{ width: 70 }}>N°</th><th>Désignation</th>
                            <th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>PU HT</th><th style={{ textAlign: 'right' }}>Total HT</th>
                          </tr></thead>
                          <tbody>{apercuLinesWithSection.map(({ line, depth, sect }) => apercuRow(line, depth, sect))}</tbody>
                        </table>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
                          <div style={{ width: 340 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">PV brut HT</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(basePvBrut)}</span></div>
                            {baseRemise > 0.001 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">Remise</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(baseRemise)}</span></div>}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)', fontWeight: 600 }}><span>Total HT</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(baseTotalHt)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span className="muted">TVA</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(baseTva)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', marginTop: 4, background: 'var(--primary)', color: '#fff', borderRadius: 'var(--radius-sm)', fontWeight: 700 }}><span>Total TTC</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(baseTtc)}</span></div>
                            {(hasVariante || hasOption) && (() => {
                              const sectionRows = (sType: 'variante' | 'option') =>
                                apercuLinesWithSection
                                  .filter(({ sect }) => sect === sType)
                                  .filter(({ line }) => {
                                    const parent = lineById.get(line.parent_line_id ?? '');
                                    if (!parent) return true;
                                    let cur: DevisLine | undefined = parent;
                                    while (cur) {
                                      if (cur.section_type === sType) return false;
                                      cur = cur.parent_line_id ? lineById.get(cur.parent_line_id) : undefined;
                                    }
                                    return true;
                                  });
                              const RecapSection = ({ sType, color, label }: { sType: 'variante' | 'option'; color: string; label: string }) => {
                                const rows = sectionRows(sType);
                                const total = sType === 'variante' ? apercuTotals.variante : apercuTotals.option;
                                return (
                                  <div style={{ marginTop: 20 }}>
                                    <div style={{ background: color, color: '#fff', padding: '6px 12px', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                      <thead><tr style={{ background: '#f8fafc', borderBottom: `2px solid ${color}` }}>
                                        <th style={{ textAlign: 'left', padding: '4px 8px', width: 60, fontWeight: 600 }}>N°</th>
                                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Désignation</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>Total H.T.</th>
                                      </tr></thead>
                                      <tbody>
                                        {rows.map(({ line }) => {
                                          const item = itemById.get(line.id);
                                          const pvVal = item ? Number(item.pv) : (titrePvByRoot.get(line.id) ?? 0);
                                          return (
                                            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                              <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#64748b', fontSize: 11 }}>{line.numero ?? ''}</td>
                                              <td style={{ padding: '4px 8px' }}>{line.designation}</td>
                                              <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{e(pvVal)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                      <tfoot><tr style={{ background: color, color: '#fff' }}>
                                        <td colSpan={2} style={{ padding: '5px 8px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total {label} H.T.</td>
                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{e(total)}</td>
                                      </tr></tfoot>
                                    </table>
                                  </div>
                                );
                              };
                              return (
                                <div style={{ marginTop: 24, borderTop: '2px solid var(--border)', paddingTop: 16, width: '100%' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 4 }}>Récapitulatif Variantes &amp; Options</div>
                                  {hasVariante && <RecapSection sType="variante" color="#f97316" label="Variantes" />}
                                  {hasOption && <RecapSection sType="option" color="#a855f7" label="Options" />}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : <p className="muted">Devis vide — construisez-le dans l&apos;onglet Étude de prix.</p>}
                  </div>
                );
              })()}
            </div>

            <aside className="synthese-panel" data-panel="2">
              {(tab === 'etude' || tab === 'apercu') && (
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
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={exportDebours}>Export Débours (Excel)</button>
                  <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => setApproOpen(true)}>Calcul Appro</button>
                </>
              )}

              {tab === 'coeffs' && (
                <>
                  <div className="form-section-title">Calcul du prix de vente</div>
                  <div className="synthese-row"><span className="lbl">Débours</span><span className="val" style={{ color: 'var(--accent)' }}>{e(sale.data?.totalDebourse)}</span></div>
                  <div className="synthese-row" style={{ color: 'var(--primary)' }}><span className="lbl">× FG → Prix de revient</span><span className="val">{e(sale.data?.totalRevient)}</span></div>
                  <div className="synthese-row" style={{ color: 'var(--primary)' }}><span className="lbl">× Bén. → PV hors frais</span><span className="val">{e(sale.data?.pvHorsFrais)}</span></div>
                  {Number(sale.data?.fraisAnnexes) > 0.001 && (
                    <div className="synthese-row" style={{ color: '#d97706' }}><span className="lbl">+ Frais annexes</span><span className="val">{e(sale.data?.fraisAnnexes)}</span></div>
                  )}
                  <div className="synthese-row" style={{ borderTop: '1px solid var(--border)', fontWeight: 700, paddingTop: 6 }}><span>PV final</span><span className="val">{e(sale.data?.pvDevis)}</span></div>
                  <div style={{ background: 'var(--primary)', color: '#fff', borderRadius: 6, textAlign: 'center', padding: '10px 12px', margin: '12px 0' }}>
                    <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>Coefficient global (Deb. → PV)</div>
                    <div style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>×{coeffStr(sale.data?.pvHorsFrais, sale.data?.totalDebourse)}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>PV hors frais = Débours × {coeffStr(sale.data?.pvHorsFrais, sale.data?.totalDebourse)}</div>
                  </div>
                  <div className="form-section-title" style={{ marginTop: 8 }}>Coefficients par nature</div>
                  {(Object.keys(NATURE_LABELS) as Nat[]).map((n) => {
                    const c = coef[n];
                    const k = (1 + Number(c.fg) / 100) * (1 + Number(c.ben) / 100);
                    return (
                      <div key={n} className="synthese-row">
                        <span className="lbl" style={{ fontSize: 11 }}>{NATURE_LABELS[n]}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--primary)' }}>×{k.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </>
              )}

              {tab === 'client' && (
                <>
                  <div className="form-section-title">Récapitulatif client</div>
                  <div className="synthese-row"><span className="lbl">PV brut HT</span><span className="val">{e(sale.data?.pvDevis)}</span></div>
                  <div className="synthese-row">
                    <span className="lbl">Remise</span>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input style={{ width: 56, textAlign: 'right' }} value={remise.valeur}
                        onChange={(ev) => setRemise({ ...remise, valeur: ev.target.value })} />
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

      {libraryOpen && (
        <LibraryDrawer
          token={token}
          onClose={() => setLibraryOpen(false)}
          containerId={workspace.splitOpen ? (isPanel2 ? 'split-panel-b-library' : 'split-panel-a-library') : undefined}
        />
      )}

      {approOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setApproOpen(false)}>
          <div className="card" style={{ width: 'min(920px, 96vw)', maxHeight: '85vh', overflow: 'auto' }} onClick={(ev) => ev.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Calcul approvisionnement</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={exportAppro} disabled={!appro.data?.length}>Export Excel</button>
                <button className="btn-ghost" onClick={() => setApproOpen(false)}>✕</button>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>Quantités d&apos;achat par ressource (quantité d&apos;emploi ÷ coefficient de conversion).</p>
            {appro.isLoading ? <p className="muted">Calcul…</p> : appro.data?.length ? (
              <table className="grid" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Code</th><th>Désignation</th><th style={{ textAlign: 'right' }}>Qté emploi</th>
                  <th>U. achat</th><th style={{ textAlign: 'right' }}>Coeff</th>
                  <th style={{ textAlign: 'right' }}>Qté appro</th><th style={{ textAlign: 'right' }}>Montant HT</th><th>Fournisseur</th>
                </tr></thead>
                <tbody>
                  {appro.data.map((r, i) => (
                    <tr key={i}>
                      <td className="code-cell">{r.code ?? '—'}</td><td>{r.designation}</td>
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
            ) : <p className="muted">Aucune ressource de bibliothèque dans ce devis.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
