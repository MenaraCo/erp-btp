'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, apiDownload, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';
import { usePreferences, fmtEuro, cleanNum } from '@/lib/preferences';
import { downloadStyledXlsx, SheetCell, StyleKey } from '@/lib/xlsx';
import { visibleForClient } from '@/lib/client-view';
import { useWorkspace } from '@/lib/workspace';
import { Montage, MontageLine } from './Montage';
import { LibraryDrawer } from './LibraryDrawer';
import { WorkflowBar } from './WorkflowBar';

const round = (v: number, n: number) => Number((Number(v) || 0).toFixed(n));

interface Version { id: string; version_no: number; label: string }
interface DevisDetail {
  devis: {
    id: string; numero: string | null; designation: string; type: string; status: string;
    responsable?: string | null; priorite?: string | null;
    date_debut?: string | null; date_echeance?: string | null;
  };
  versions: Version[];
}
interface DevisLine {
  id: string; parent_line_id: string | null; type: string; code: string | null;
  code_analytique: string | null; designation: string; unit: string | null;
  quantity: string | null; pu: string | null; perte: string | null; nature: string | null;
  cadence: string | null; prix_public: string | null;
  pu_vente: string | null; pu_vente_force: boolean;
  section_type: 'option' | 'variante' | null; source_ouvrage_id: string | null;
  source_resource_id: string | null;
  sort_order: number; numero?: string | null; num_custom?: string | null;
  unite_achat?: string | null; coeff_conversion?: string | null; supplier_id?: string | null;
  ref_fournisseur?: string | null; conditionnement?: string | null;
}
interface SaleItem {
  id: string; debourse: string; revient: string; pvComputed: string; pv: string;
  forced: boolean; margeBrute: string; margeNette: string; ventilatedFrais: string;
  debourseByNature?: Record<'labor' | 'material' | 'equipment' | 'subcontract', string>;
  debourseBySt?: Record<string, string>;
}
interface SaleSheet {
  items: SaleItem[]; totalDebourse: string; totalRevient: string; pvHorsFrais: string;
  fraisAnnexes: string; pvDevis: string; remise: string; totalPvHt: string;
  margeBrute: string; margeNette: string; coeffGlobalReel: string; tva: string; totalTtc: string;
  pvImposeApplied?: boolean; coeffAjustement?: string;
  fraisAnnexesIntegres?: string;
  fraisDetail?: { designation: string; montant: string }[];
}
type Nat = 'labor' | 'material' | 'equipment' | 'subcontract';
const NATURE_LABELS: Record<Nat, string> = {
  labor: "Main d'œuvre", material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
};
interface FraisRow { designation: string; type: 'pct' | 'fixe'; valeur: string; mode?: 'separe' | 'inclus' | null }
/** Type de déboursé utilisable sur ce devis, avec ses taux retenus pour ce devis. */
interface DebType {
  id: string;
  code: string;
  label: string;
  baseNature: string;
  builtin: boolean;
  /** Non nul = type créé pour ce devis seul (supprimable, versable au référentiel). */
  devisVersionId: string | null;
  tauxFg: string;
  tauxBenefice: string;
}

interface StType { id: string; code?: string | null; label: string; tauxFg: string; tauxBenefice: string }
interface SaleConfig {
  configured: boolean;
  byNature: Record<Nat, { tauxFg: string; tauxBenefice: string }> | null;
  stTypes?: StType[];
  types?: DebType[];
  arrondi?: { pas: string; mode: 'proche' | 'sup' | 'inf' } | null;
  pvImpose?: string | null;
  fraisMode?: 'separe' | 'inclus';
  remise: { type: 'pct' | 'fixe'; valeur: string } | null;
  tvaRate: string | null;
  fraisAnnexes: { designation: string; type: 'pct' | 'fixe'; valeur: string; mode?: 'separe' | 'inclus' | null }[];
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

/** Assemble des morceaux d'intitulé en ignorant les vides : « TES1 » et non « — TES1 ». */
function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.map((x) => (x ?? '').trim()).filter(Boolean).join(' — ') || '—';
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
  // Synthèse : 3 états — caché (défaut), flottant (popover par-dessus), épinglé (docké, recadre).
  const [synthPinned, setSynthPinned] = useState(false);
  const [synthFloatOpen, setSynthFloatOpen] = useState(false);
  const synthPanelRef = useRef<HTMLElement | null>(null);
  const synthBtnRef = useRef<HTMLButtonElement | null>(null);
  // Popover flottant : se ferme au clic en dehors (hors bouton déclencheur et hors panneau).
  useEffect(() => {
    if (!synthFloatOpen || synthPinned) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (synthPanelRef.current?.contains(t) || synthBtnRef.current?.contains(t)) return;
      setSynthFloatOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [synthFloatOpen, synthPinned]);

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
    affaire: {
      id: string; code: string; name: string;
      client?: { id: string; code: string; name: string; email: string | null; phone: string | null } | null;
    };
    devis: Array<{ id: string; numero: string | null; designation: string; versions: Version[] }>
  }>({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch(`/affaires/${affaireId}`, { token }),
  });

  const [devisSettings, setDevisSettings] = useState(false);
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
  // B.1 — types de sous-traitance propres à CE devis (chacun ses FG/bénéfice).
  const [stTypes, setStTypes] = useState<StType[]>([]);
  // Types de déboursé de l'entreprise (référentiel société + types propres à ce devis), avec
  // les % FG et % bénéfice retenus SUR CE DEVIS.
  const [debTypes, setDebTypes] = useState<DebType[]>([]);
  const [newType, setNewType] = useState({ code: '', label: '', baseNature: 'material' });
  // B.3 — arrondi commercial du PV de ligne + PV total imposé.
  const [arrondi, setArrondi] = useState<{ pas: string; mode: 'proche' | 'sup' | 'inf' }>({ pas: '0', mode: 'proche' });
  const [pvImpose, setPvImpose] = useState('');
  // Frais annexes : poste visible sur le devis, ou noyés dans les prix unitaires.
  const [fraisMode, setFraisMode] = useState<'separe' | 'inclus'>('separe');
  const [tva, setTva] = useState('20');
  const tvaPrefsApplied = useRef(false);
  useEffect(() => {
    if (tvaPrefsApplied.current || !prefs.id || prefs.taux_tva.length === 0) return;
    tvaPrefsApplied.current = true;
    const def = prefs.taux_tva.filter(t => t > 0).slice(-1)[0] ?? 20;
    setTva(String(def));
  }, [prefs.id, prefs.taux_tva]);

  // Types de déboursé : créés pour CE devis, versés au référentiel société, ou retirés.
  const refreshTypes = () => qc.invalidateQueries({ queryKey: ['sale-config', versionId] });
  const addType = useMutation({
    mutationFn: () =>
      apiFetch<DebType>('/debourse-types', {
        method: 'POST',
        body: { ...newType, code: newType.code.trim(), label: newType.label.trim(), devisVersionId: versionId },
        token,
      }),
    onSuccess: (t) => {
      // Le nouveau type prend d'emblée les taux par défaut de la société.
      setDebTypes((prev) => [...prev, {
        ...t,
        tauxFg: String(Number(prefs.taux_fg_default) || 0),
        tauxBenefice: String(Number(prefs.taux_ben_default) || 0),
      }]);
      setNewType({ code: '', label: '', baseNature: 'material' });
      setErr(null);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Type impossible à créer.'),
  });
  const promoteType = useMutation({
    mutationFn: (id: string) => apiFetch(`/debourse-types/${id}/promote`, { method: 'POST', token }),
    onSuccess: (_r, id) => {
      setDebTypes((prev) => prev.map((t) => (t.id === id ? { ...t, devisVersionId: null } : t)));
      refreshTypes();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Type impossible à verser au référentiel.'),
  });
  const removeType = useMutation({
    mutationFn: (id: string) => apiFetch(`/debourse-types/${id}`, { method: 'DELETE', token }),
    onSuccess: (_r, id) => {
      setDebTypes((prev) => prev.filter((t) => t.id !== id));
      refreshTypes();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Type impossible à supprimer.'),
  });

  const setSale = useMutation({
    mutationFn: () =>
      apiFetch(`/versions/${versionId}/sale-sheet`, {
        method: 'PUT',
        body: {
          types: debTypes.map((t) => ({
            typeId: t.id, tauxFg: t.tauxFg || '0', tauxBenefice: t.tauxBenefice || '0',
          })),
          stTypes: stTypes.filter((t) => t.label.trim()),
          arrondi: { pas: arrondi.pas || '0', mode: arrondi.mode },
          pvImpose: pvImpose.trim() === '' ? null : pvImpose,
          fraisMode,
          remise: { type: remise.type, valeur: remise.valeur || '0' },
          tvaRate: String((Number(tva) || 0) / 100),
        },
        token,
      }),
    onSuccess: () => refresh(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // Paramètres du devis : identité (numéro, désignation, type) et pilotage (responsable,
  // priorité, dates). Deux endpoints distincts côté API, une seule validation pour l'utilisateur.
  const saveDevisSettings = useMutation({
    mutationFn: async (v: {
      numero: string; designation: string; type: string;
      responsable: string; priorite: string; dateDebut: string; dateEcheance: string;
    }) => {
      await apiFetch(`/devis/${devisId}`, {
        method: 'PATCH',
        body: { numero: v.numero.trim() || null, designation: v.designation.trim(), type: v.type },
        token,
      });
      await apiFetch(`/devis/${devisId}/planning`, {
        method: 'PATCH',
        body: {
          responsable: v.responsable.trim() || null,
          priorite: v.priorite,
          dateDebut: v.dateDebut || null,
          dateEcheance: v.dateEcheance || null,
        },
        token,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis', devisId] });
      qc.invalidateQueries({ queryKey: ['devis-list'] });
      setDevisSettings(false);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
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
        body: {
          frais: frais.map((f) => ({
            designation: f.designation,
            type: f.type,
            valeur: f.valeur || '0',
            // Sans le mode, le poste retombait sur le réglage global du devis : tous les
            // frais se retrouvaient noyés dans les prix, y compris ceux marqués « Séparé ».
            mode: f.mode ?? 'separe',
          })),
        },
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
  // Vue client : ni sous-détail d'ouvrage, ni ligne de frais (son coût est déjà dans les prix),
  // ni titre qui ne contiendrait que des frais. Même règle que le PDF.
  const clientLines = useMemo(() => {
    const vus = visibleForClient(lines.data ?? []);
    return ordered.filter(
      (o) =>
        !(o.line.type === 'ressource' && o.line.parent_line_id && ouvrageIds.has(o.line.parent_line_id)) &&
        vus.has(o.line.id),
    );
  }, [ordered, ouvrageIds, lines.data]);
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
    const rows: SheetCell[][] = [
      [{ v: `Déboursé — ${joinParts(d?.numero, d?.designation)}`, s: 'title' }],
      [{ v: 'Document interne : coûts directs, hors frais généraux et bénéfice.', s: 'subtitle' }],
      [],
      ['Code', 'Désignation', 'Quantité', 'PU déboursé', 'Montant HT'].map((h) => ({ v: h, s: 'header' as StyleKey })),
    ];
    for (const r of agg.values()) {
      rows.push([
        { v: r.code, s: 'num' }, { v: r.designation, s: 'text' },
        { v: round(r.qty, 3), s: 'qty' }, { v: round(r.pu, 4), s: 'money' },
        { v: round(r.montant, 2), s: 'money' },
      ]);
    }
    downloadStyledXlsx(`debours_${d?.numero || devisId}`, rows, {
      sheetName: 'Déboursé', cols: [14, 60, 12, 14, 16], merges: ['A1:E1', 'A2:E2'], freezeRows: 4,
      theme: { primary: prefs.couleur_principale, accent: prefs.couleur_accent },
    });
  }

  const [approOpen, setApproOpen] = useState(false);
  const appro = useQuery({
    queryKey: ['appro', versionId],
    enabled: Boolean(token && versionId && approOpen),
    queryFn: () => apiFetch<ApproRow[]>(`/versions/${versionId}/appro`, { token }),
  });
  function exportAppro() {
    const num = (v: unknown) => (v == null || v === '' ? '' : Number(v));
    const rows: SheetCell[][] = [
      [{ v: `Calcul d'approvisionnement — ${joinParts(d?.numero, d?.designation)}`, s: 'title' }],
      [{ v: 'Quantités converties en unités d’achat, par fournisseur.', s: 'subtitle' }],
      [],
      ['Code', 'Désignation', 'Qté emploi', 'Unité achat', 'Coeff', 'Qté appro', 'Prix public', 'Montant HT', 'Fournisseur']
        .map((h) => ({ v: h, s: 'header' as StyleKey })),
    ];
    for (const r of appro.data ?? []) {
      rows.push([
        { v: r.code ?? '', s: 'num' }, { v: r.designation, s: 'text' },
        { v: num(r.qteEmploi), s: 'qty' }, { v: r.uniteAchat ?? '', s: 'unit' },
        { v: num(r.coeffConversion), s: 'qty' }, { v: num(r.qteAppro), s: 'qty' },
        { v: num(r.prixPublic), s: 'money' }, { v: num(r.montant), s: 'money' },
        { v: r.fournisseur ?? '', s: 'text' },
      ]);
    }
    downloadStyledXlsx(`appro_${d?.numero || devisId}`, rows, {
      sheetName: 'Appro', cols: [14, 48, 12, 12, 9, 12, 13, 15, 24],
      merges: ['A1:I1', 'A2:I2'], freezeRows: 4,
      theme: { primary: prefs.couleur_principale, accent: prefs.couleur_accent },
    });
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
      setStTypes(cfg.stTypes ?? []);
      setDebTypes(cfg.types ?? []);
      if (cfg.arrondi) setArrondi({ pas: String(Number(cfg.arrondi.pas)), mode: cfg.arrondi.mode });
      setPvImpose(cfg.pvImpose != null ? String(Number(cfg.pvImpose)) : '');
      setFraisMode(cfg.fraisMode ?? 'separe');
      if (cfg.remise) setRemise({ type: cfg.remise.type, valeur: String(Number(cfg.remise.valeur)) });
      if (cfg.tvaRate) setTva(String(Number(cfg.tvaRate) * 100));
    } else {
      const fg = String(Number(prefs.taux_fg_default) || 25);
      const ben = String(Number(prefs.taux_ben_default) || 15);
      setCoef({ labor: { fg, ben }, material: { fg, ben }, equipment: { fg, ben }, subcontract: { fg, ben } });
      // Devis neuf : tous les types partent des taux par défaut de la société.
      setDebTypes((cfg.types ?? []).map((t) => ({ ...t, tauxFg: fg, tauxBenefice: ben })));
    }
    setFrais((cfg.fraisAnnexes ?? []).map((f) => ({
      designation: f.designation, type: f.type, valeur: String(Number(f.valeur)),
      mode: f.mode ?? 'separe',
    })));
  }, [saleConfig.data, versionId, prefs.taux_fg_default, prefs.taux_ben_default]);

  const pdfFilename = () => {
    const ref = detail.data?.devis?.numero ?? detail.data?.devis?.designation ?? 'devis';
    const v = versions.length > 1 ? `-v${versions.find((x) => x.id === versionId)?.version_no ?? ''}` : '';
    return `Devis-${String(ref).replace(/[^\w.-]+/g, '_')}${v}.pdf`;
  };

  /**
   * Prépare l'envoi du devis par mail : le PDF est téléchargé, puis le client de messagerie
   * s'ouvre avec destinataire, objet et corps pré-remplis depuis le modèle des Paramètres.
   *
   * Un lien mailto ne peut PAS porter de pièce jointe (limite des clients de messagerie) :
   * le PDF est donc téléchargé à côté, il reste à le glisser dans le message.
   */
  async function sendByMail() {
    if (!versionId) return;
    setPdfError(null);
    const cli = affaireDetail.data?.affaire?.client ?? null;
    const aff = affaireDetail.data?.affaire;
    const fill = (tpl: string) =>
      tpl
        .replace(/\{CLIENT\}/g, cli?.name ?? 'Madame, Monsieur')
        .replace(/\{DEVIS\}/g, d?.numero ?? d?.designation ?? '')
        .replace(/\{AFFAIRE\}/g, `${aff?.code ?? ''} — ${aff?.name ?? ''}`.replace(/^ — | — $/, ''))
        .replace(/\{MONTANT_HT\}/g, e(sale.data?.totalPvHt))
        .replace(/\{MONTANT_TTC\}/g, e(sale.data?.totalTtc))
        .replace(/\{DATE\}/g, new Date().toLocaleDateString('fr-FR'))
        .replace(/\{SOCIETE\}/g, prefs.company_name ?? '');
    const objet = fill(prefs.mail_devis_objet || 'Devis {DEVIS} — {AFFAIRE}');
    const corps = fill(
      prefs.mail_devis_corps ||
        'Bonjour {CLIENT},\n\nVeuillez trouver ci-joint notre devis {DEVIS}.\n\nCordialement,\n{SOCIETE}',
    );
    try {
      // 1) le PDF d'abord : il doit être dans les téléchargements quand le brouillon s'ouvre
      await apiDownload(`/versions/${versionId}/devis.pdf`, token, pdfFilename());
    } catch {
      setPdfError('PDF indisponible — le mail est préparé sans la pièce jointe.');
    }
    // Ancre synthétique plutôt que location.href : pas de risque d'alerte « quitter la page »
    // et le lien s'ouvre dans le client mail par défaut comme un lien ordinaire.
    const to = encodeURIComponent(cli?.email ?? '');
    const href = `mailto:${to}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
    const a = document.createElement('a');
    a.href = href;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Bordereau d'appel d'offre : structure + quantités, prix laissés à compléter. */
  async function downloadBordereau() {
    if (!versionId) return;
    setPdfError(null);
    try {
      await apiDownload(
        `/versions/${versionId}/devis.pdf?bordereau=1`, token,
        pdfFilename().replace(/^Devis-/, 'Bordereau-'),
      );
    } catch {
      setPdfError('PDF indisponible.');
    }
  }

  /**
   * Export DPGF (Excel) : la décomposition du prix global et forfaitaire, une ligne par poste.
   * `avecPrix = false` produit le bordereau vierge à faire chiffrer.
   */
  /**
   * Édition Excel du devis — même mise en page que le PDF : bandeau société, identité du devis
   * et du client, tableau à colonnes tenues, totaux en pied. `avecPrix = false` produit le
   * BORDEREAU d'appel d'offre : les colonnes de prix restent vides, encadrées, prêtes à la saisie.
   */
  function exportDpgf(avecPrix: boolean) {
    const cli = affaireDetail.data?.affaire?.client ?? null;
    const aff = affaireDetail.data?.affaire;
    const dec = prefs.nb_decimales;
    const R: SheetCell[][] = [];

    // ── Bandeau : émetteur, puis nature du document et destinataire ──
    R.push([{ v: prefs.company_name || 'Devis', s: 'title' }]);
    R.push([{ v: avecPrix ? 'Décomposition du prix global et forfaitaire' : "Bordereau d'appel d'offre — prix à compléter", s: 'subtitle' }]);
    R.push([]);
    const ident: [string, string][] = [
      ['Devis', joinParts(d?.numero, d?.designation)],
      ['Affaire', joinParts(aff?.code, aff?.name)],
      ['Client', cli?.name ?? '—'],
      ['Version', String(versions.find((x) => x.id === versionId)?.version_no ?? 1)],
      ['Date', new Date().toLocaleDateString('fr-FR')],
    ];
    for (const [k, v] of ident) {
      R.push([{ v: k, s: 'label' }, { v, s: 'value' }]);
    }
    R.push([]);

    // ── En-tête du tableau (figé au défilement) ──
    const HEAD = ['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT', 'Montant HT'];
    R.push(HEAD.map((h) => ({ v: h, s: 'header' as StyleKey })));
    const freezeRows = R.length;

    // Documents remis au client : mêmes règles qu'à l'écran et au PDF — pas de ligne de frais,
    // ni de titre qui ne contiendrait qu'elles.
    const vus = visibleForClient((lines.data ?? []) as DevisLine[]);
    for (const { line, depth } of orderTree((lines.data ?? []) as DevisLine[])) {
      // Le sous-détail de déboursé ne fait pas partie du document remis au client.
      const parent = (lines.data ?? []).find((x) => x.id === line.parent_line_id);
      if (parent?.type === 'ouvrage') continue;
      if (line.type === 'texte') continue;
      if (!vus.has(line.id)) continue;

      const item = itemById.get(line.id);
      const isTitre = line.type === 'titre' || line.type === 'sous_titre';
      const qty = line.quantity != null ? Number(line.quantity) : null;
      const pv = item ? Number(item.pv) : null;
      const pu = item && qty ? Number(item.pv) / qty : null;

      if (isTitre) {
        const st: StyleKey = depth === 0 ? 'group1' : 'group2';
        R.push([
          { v: line.numero ?? '', s: st },
          { v: `${'    '.repeat(depth)}${line.designation}`, s: st },
          { v: '', s: st }, { v: '', s: st }, { v: '', s: st },
          // Le sous-total d'un titre n'a de sens que sur un document chiffré.
          avecPrix ? { v: titrePvByRoot.get(line.id) ?? null, s: 'moneyBold' } : { v: '', s: st },
        ]);
        continue;
      }
      R.push([
        { v: line.numero ?? '', s: 'num' },
        { v: `${'    '.repeat(depth)}${line.designation}`, s: 'text' },
        { v: line.unit ?? '', s: 'unit' },
        { v: qty, s: 'qty' },
        avecPrix ? { v: pu != null ? round(pu, dec) : null, s: 'money' } : { v: '', s: 'fill' },
        avecPrix ? { v: pv != null ? round(pv, dec) : null, s: 'money' } : { v: '', s: 'fill' },
      ]);
    }

    // ── Pied : totaux chiffrés, ou cases à remplir pour le bordereau ──
    R.push([]);
    const pied = (libelle: string, montant: number | null) =>
      R.push([
        null, null, null, null,
        { v: libelle, s: 'totalLabel' },
        montant != null ? { v: round(montant, dec), s: 'totalMoney' } : { v: '', s: 'fill' },
      ]);
    if (avecPrix && sale.data) {
      for (const fd of sale.data.fraisDetail ?? []) pied(fd.designation, Number(fd.montant));
      pied('TOTAL HT', Number(sale.data.totalPvHt));
      pied('TVA', Number(sale.data.tva));
      pied('TOTAL TTC', Number(sale.data.totalTtc));
    } else {
      pied('TOTAL HT', null);
      pied('TVA', null);
      pied('TOTAL TTC', null);
    }

    downloadStyledXlsx(
      `${avecPrix ? 'DPGF' : 'Bordereau'}_${d?.numero || d?.designation || devisId}`,
      R,
      {
        sheetName: avecPrix ? 'DPGF' : 'Bordereau',
        cols: [10, 62, 8, 12, 14, 16],
        merges: ['A1:F1', 'A2:F2'],
        freezeRows,
        theme: { primary: prefs.couleur_principale, accent: prefs.couleur_accent },
      },
    );
  }

  async function downloadPdf() {
    if (!versionId) return;
    setPdfError(null);
    try {
      await apiDownload(`/versions/${versionId}/devis.pdf`, token, pdfFilename());
    } catch {
      setPdfError('PDF indisponible.');
    }
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
            <span className={d.status === 'won' ? 'badge success' : d.status === 'lost' ? 'badge danger' : d.status === 'sent' ? 'badge info' : 'badge'}>
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
                <button type="button" className="btn-secondary" onClick={() => setDevisSettings(true)}
                  style={{ fontSize: 10, padding: '2px 8px', marginLeft: 4 }}>Paramètres du devis</button>
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
                {!isSplitOpen && !libraryOpen && (
                  <button ref={synthBtnRef} type="button"
                    onClick={() => {
                      if (synthPinned) { setSynthPinned(false); setSynthFloatOpen(false); }
                      else setSynthFloatOpen((v) => !v);
                    }}
                    className="btn-secondary"
                    title={synthPinned ? 'Détacher et masquer la synthèse' : synthFloatOpen ? 'Masquer la synthèse' : 'Afficher la synthèse (par-dessus, sans recadrer)'}
                    style={{ fontSize: 11, padding: '3px 10px', marginBottom: 2, background: (synthPinned || synthFloatOpen) ? 'var(--primary)' : undefined, color: (synthPinned || synthFloatOpen) ? '#fff' : undefined }}>
                    ▤ Synthèse{synthPinned ? ' 📌' : ''}
                  </button>
                )}
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

          <div className={`editor-grid${libraryOpen ? ' library-open' : ''}${workspace.splitOpen ? ' split-active' : ''}${!libraryOpen && !workspace.splitOpen ? (synthPinned ? ' synth-pinned' : synthFloatOpen ? ' synth-floating' : ' synth-hidden') : ''}`}>
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
                    natureById={new Map((sale.data?.items ?? []).filter((i) => i.debourseByNature).map((i) => [i.id, i.debourseByNature!]))}
                    decimals={prefs.nb_decimales}
                    onChanged={refresh}
                    readOnly={!isLatest}
                    acceptDrop={libraryOpen}
                  />
                </div>
              )}

              {tab === 'coeffs' && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h2>Feuille de vente — frais généraux &amp; bénéfice par type</h2>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Déboursé × (1 + FG %) = prix de revient, puis × (1 + Bénéfice %) = prix de vente.
                    Les types viennent de vos <strong>Paramètres → Types de déboursé</strong> ; vous
                    pouvez en ajouter un pour ce devis seul, puis le verser au référentiel.
                  </p>
                  <form onSubmit={(ev) => {
                    ev.preventDefault(); setErr(null);
                    // Une seule validation pour toute la feuille : coefficients + frais annexes.
                    setSale.mutate();
                    setFraisAnnexes.mutate();
                  }}>
                    <table className="grid" style={{ marginBottom: 8 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 80 }}>Code</th>
                          <th>Intitulé</th>
                          <th style={{ width: 150 }}>Rattaché à</th>
                          <th style={{ textAlign: 'right', width: 90 }}>FG %</th>
                          <th style={{ textAlign: 'right', width: 90 }}>Bénéfice %</th>
                          <th style={{ textAlign: 'right', width: 80 }}>Coeff.</th>
                          <th style={{ width: 70 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {debTypes.map((t, i) => {
                          const k = (1 + Number(t.tauxFg || 0) / 100) * (1 + Number(t.tauxBenefice || 0) / 100);
                          const upd = (patch: Partial<DebType>) =>
                            setDebTypes(debTypes.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                          const local = t.devisVersionId != null;
                          return (
                            <tr key={t.id}>
                              <td className="code-cell">{t.code}</td>
                              <td>
                                {t.label}
                                {local && (
                                  <span className="badge" style={{ marginLeft: 6 }}>propre à ce devis</span>
                                )}
                              </td>
                              <td className="muted">{NATURE_LABELS[t.baseNature as Nat] ?? t.baseNature}</td>
                              <td style={{ textAlign: 'right' }}>
                                <input style={{ width: 64, textAlign: 'right' }} value={t.tauxFg} disabled={!isLatest}
                                  onChange={(ev) => upd({ tauxFg: ev.target.value })} />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <input style={{ width: 64, textAlign: 'right' }} value={t.tauxBenefice} disabled={!isLatest}
                                  onChange={(ev) => upd({ tauxBenefice: ev.target.value })} />
                              </td>
                              <td style={{ textAlign: 'right' }} className="muted">{k.toFixed(3)}</td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {local && (
                                  <>
                                    <button type="button" className="btn-ghost" title="Verser au référentiel société"
                                      disabled={!isLatest} onClick={() => promoteType.mutate(t.id)}>↑</button>
                                    <button type="button" className="btn-ghost" title="Supprimer ce type"
                                      disabled={!isLatest} onClick={() => removeType.mutate(t.id)}>✕</button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Ajout d'un type pour CE devis : le référentiel société se gère dans Paramètres. */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Code</label>
                        <input className="input" style={{ width: 90 }} placeholder="LOC" value={newType.code}
                          disabled={!isLatest} onChange={(ev) => setNewType({ ...newType, code: ev.target.value })} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Intitulé</label>
                        <input className="input" style={{ width: 220 }} placeholder="Location de matériel"
                          value={newType.label} disabled={!isLatest}
                          onChange={(ev) => setNewType({ ...newType, label: ev.target.value })} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Rattaché à</label>
                        <select className="input" style={{ width: 160 }} value={newType.baseNature} disabled={!isLatest}
                          onChange={(ev) => setNewType({ ...newType, baseNature: ev.target.value })}>
                          {(Object.keys(NATURE_LABELS) as Nat[]).map((n) => (
                            <option key={n} value={n}>{NATURE_LABELS[n]}</option>
                          ))}
                        </select>
                      </div>
                      <button type="button" className="btn-secondary" disabled={!isLatest || !newType.code.trim() || !newType.label.trim()}
                        onClick={() => addType.mutate()}>
                        + Type de déboursé
                      </button>
                    </div>

                    <div className="form-section-title" style={{ marginTop: 4 }}>Arrondi &amp; prix imposé</div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Arrondi du PV</label>
                        <select className="input" style={{ width: 150 }} value={arrondi.pas} disabled={!isLatest}
                          onChange={(ev) => setArrondi({ ...arrondi, pas: ev.target.value })}>
                          <option value="0">Aucun (au centime)</option>
                          <option value="0.05">5 centimes</option>
                          <option value="0.5">50 centimes</option>
                          <option value="1">À l&apos;euro</option>
                          <option value="5">5 €</option>
                          <option value="10">10 €</option>
                          <option value="100">100 €</option>
                        </select>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Sens</label>
                        <select className="input" style={{ width: 130 }} value={arrondi.mode} disabled={!isLatest || arrondi.pas === '0'}
                          onChange={(ev) => setArrondi({ ...arrondi, mode: ev.target.value as 'proche' | 'sup' | 'inf' })}>
                          <option value="proche">Au plus proche</option>
                          <option value="sup">Supérieur</option>
                          <option value="inf">Inférieur</option>
                        </select>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>PV total imposé (HT)</label>
                        <input className="input" style={{ width: 150, textAlign: 'right' }} placeholder="— libre —"
                          value={pvImpose} disabled={!isLatest} onChange={(ev) => setPvImpose(ev.target.value)} />
                      </div>
                    </div>
                    <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 11 }}>
                      L&apos;arrondi s&apos;applique au PV calculé de chaque ligne (un PV forcé est conservé tel quel).
                      Le PV imposé ajuste au prorata les lignes non forcées pour atteindre exactement ce total —
                      le déboursé et le prix de revient ne changent pas, seule la marge s&apos;ajuste.
                    </p>

                    <div className="form-section-title" style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Frais annexes</span>
                      <button className="btn-secondary" type="button" disabled={!isLatest}
                        style={{ textTransform: 'none', letterSpacing: 0 }}
                        onClick={() => setFrais([...frais, { designation: '', type: 'pct', valeur: '0', mode: 'separe' }])}>+ Poste</button>
                    </div>
                    <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: 11 }}>
                      Chaque poste se règle indépendamment : <strong>Séparé</strong> = ligne visible sur
                      le devis sous son propre intitulé ; <strong>Noyé</strong> = réparti dans les prix
                      unitaires, invisible pour le client. Le total HT est le même dans les deux cas.
                    </p>
                    {frais.length === 0 ? (
                      <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
                        Aucun poste. Ex : compte prorata (% du PV) ou installation de chantier (montant fixe).
                      </p>
                    ) : (
                      <>
                        <table className="grid" style={{ marginBottom: 6 }}>
                          <thead><tr><th>Désignation</th><th style={{ width: 130 }}>Type</th><th style={{ textAlign: 'right', width: 110 }}>Valeur</th><th style={{ width: 190 }}>Sur le devis</th><th style={{ width: 40 }} /></tr></thead>
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
                                <td>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    {([['separe', 'Séparé'], ['inclus', 'Noyé']] as const).map(([v, l]) => {
                                      const active = (f.mode ?? 'separe') === v;
                                      return (
                                        <button key={v} type="button" disabled={!isLatest}
                                          onClick={() => setFrais(frais.map((x, j) => j === i ? { ...x, mode: v } : x))}
                                          style={{
                                            padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
                                            border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                                            background: active ? '#eff6ff' : '#fff',
                                            color: active ? 'var(--primary)' : 'inherit',
                                            fontWeight: active ? 700 : 400,
                                          }}>{l}</button>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <button className="btn-ghost" type="button" title="Retirer ce poste"
                                    onClick={() => setFrais(frais.filter((_, j) => j !== i))}>✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sale.data && (
                          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 11 }}>
                            Frais séparés : <strong>{e(sale.data.fraisAnnexes)}</strong>
                            {Number(sale.data.fraisAnnexesIntegres ?? 0) > 0.005 && (
                              <> · noyés dans les prix : <strong>{e(sale.data.fraisAnnexesIntegres)}</strong></>
                            )}
                            {' · '}total appliqué :{' '}
                            <strong>{e(Number(sale.data.fraisAnnexes) + Number(sale.data.fraisAnnexesIntegres ?? 0))}</strong>
                          </p>
                        )}
                      </>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>TVA</label>
                        <select className="input" style={{ width: 120 }} value={tva} onChange={(ev) => setTva(ev.target.value)} disabled={!isLatest}>
                          {prefs.taux_tva.map((t) => (
                            <option key={t} value={String(t)}>{t === 0 ? 'Autoliquidée (0%)' : `${t}%`}</option>
                          ))}
                        </select>
                      </div>
                      <button className="btn" type="submit" disabled={setSale.isPending || setFraisAnnexes.isPending || !isLatest}>Appliquer</button>
                    </div>
                  </form>
                </div>
              )}

              {/* B.4 — récapitulatif de la feuille de vente : déboursé → revient → PV, par TYPE
                  de déboursé, avec marges et coefficients réels. */}
              {tab === 'coeffs' && sale.data && (() => {
                const items = sale.data.items ?? [];
                const main = items.filter((i) => !('section' in i) || (i as { section?: string }).section === 'main');
                const nats: Nat[] = ['labor', 'material', 'equipment', 'subcontract'];
                const debParNature = (n: Nat) =>
                  main.reduce((acc, i) => acc + Number(i.debourseByNature?.[n] ?? 0), 0);
                // Déboursé rattaché à un TYPE (clé = id du type). Attention : le moteur le reverse
                // AUSSI dans la nature du type — il faut donc le retrancher de la ligne « nature »
                // pour ne pas compter deux fois la même somme.
                const typeIds = Array.from(new Set(main.flatMap((i) => Object.keys(i.debourseBySt ?? {}))));
                const debParType = (id: string) =>
                  main.reduce((acc, i) => acc + Number(i.debourseBySt?.[id] ?? 0), 0);
                const typeOf = (id: string) => debTypes.find((t) => t.id === id);
                const debTypeParNature = (n: Nat) =>
                  typeIds.reduce(
                    (acc, id) => (typeOf(id)?.baseNature === n ? acc + debParType(id) : acc),
                    0,
                  );
                const cascade = (deb: number, fg: string, ben: string) => {
                  const revient = deb * (1 + Number(fg) / 100);
                  return { revient, pv: revient * (1 + Number(ben) / 100) };
                };
                const rows: { label: string; deb: number; fg: string; ben: string }[] = [
                  // Part non typée de chaque nature (ressources sans type de déboursé).
                  ...nats.map((n) => ({
                    label: `${NATURE_LABELS[n]} (sans type)`,
                    deb: debParNature(n) - debTypeParNature(n),
                    fg: coef[n].fg,
                    ben: coef[n].ben,
                  })),
                  // Une ligne par type de déboursé effectivement utilisé, à SES taux.
                  ...typeIds.map((id) => {
                    const t = typeOf(id);
                    const nat = (t?.baseNature ?? 'subcontract') as Nat;
                    return {
                      label: t ? `${t.code} — ${t.label}` : `Type inconnu « ${id} »`,
                      deb: debParType(id),
                      fg: t?.tauxFg ?? coef[nat].fg,
                      ben: t?.tauxBenefice ?? coef[nat].ben,
                    };
                  }),
                ].filter((r) => r.deb > 0.005);
                // Les lignes par nature sont indicatives (recalculées) ; le TOTAL reprend les
                // chiffres du moteur, seuls faisant foi (arrondis par ligne, PV imposé…).
                const totDeb = Number(sale.data.totalDebourse);
                const totRev = Number(sale.data.totalRevient);
                const totPv = Number(sale.data.pvHorsFrais);
                return (
                  <div className="card" style={{ marginTop: 16 }}>
                    <h2 style={{ margin: 0 }}>Feuille de vente — récapitulatif</h2>
                    <p className="muted" style={{ marginTop: 4 }}>
                      Déboursé → prix de revient → prix de vente, type de déboursé par type de déboursé.
                      Les frais de chantier sont déjà ventilés dans ces montants.
                    </p>
                    <table className="grid" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Poste</th>
                          <th style={{ textAlign: 'right' }}>Déboursé</th>
                          <th style={{ textAlign: 'right' }}>FG %</th>
                          <th style={{ textAlign: 'right' }}>Prix de revient</th>
                          <th style={{ textAlign: 'right' }}>Bén. %</th>
                          <th style={{ textAlign: 'right' }}>Prix de vente</th>
                          <th style={{ textAlign: 'right' }}>Coeff.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 && (
                          <tr><td colSpan={7} className="muted">Aucun déboursé — construisez le devis dans l&apos;onglet Étude de prix.</td></tr>
                        )}
                        {rows.map((r) => {
                          const c = cascade(r.deb, r.fg, r.ben);
                          return (
                            <tr key={r.label}>
                              <td>{r.label}</td>
                              <td style={{ textAlign: 'right' }}>{e(r.deb)}</td>
                              <td style={{ textAlign: 'right' }} className="muted">{r.fg}</td>
                              <td style={{ textAlign: 'right' }}>{e(c.revient)}</td>
                              <td style={{ textAlign: 'right' }} className="muted">{r.ben}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{e(c.pv)}</td>
                              <td style={{ textAlign: 'right' }} className="muted">
                                {r.deb > 0 ? (c.pv / r.deb).toFixed(3) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                        {rows.length > 0 && (
                          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                            <td>Total</td>
                            <td style={{ textAlign: 'right' }}>{e(totDeb)}</td>
                            <td />
                            <td style={{ textAlign: 'right' }}>{e(totRev)}</td>
                            <td />
                            <td style={{ textAlign: 'right' }}>{e(totPv)}</td>
                            <td style={{ textAlign: 'right' }}>{totDeb > 0 ? (totPv / totDeb).toFixed(3) : '—'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 14 }}>
                      {[
                        { l: 'PV hors frais', v: e(sale.data.pvHorsFrais) },
                        ...(sale.data.fraisDetail ?? []).map((fd) => ({
                          l: fd.designation || 'Frais', v: e(fd.montant),
                        })),
                        ...(Number(sale.data.fraisAnnexesIntegres ?? 0) > 0.005
                          ? [{ l: 'Frais noyés dans les prix', v: e(sale.data.fraisAnnexesIntegres) }]
                          : []),
                        { l: 'Remise', v: e(sale.data.remise) },
                        { l: 'Total HT', v: e(sale.data.totalPvHt) },
                        { l: 'Marge brute', v: `${e(sale.data.margeBrute)}${marginPct(sale.data.margeBrute, sale.data.totalPvHt)}` },
                        { l: 'Marge nette', v: `${e(sale.data.margeNette)}${marginPct(sale.data.margeNette, sale.data.totalPvHt)}` },
                      ].map((k) => (
                        <div key={k.l} style={{ background: 'var(--surface)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                          <div className="label" style={{ marginBottom: 2 }}>{k.l}</div>
                          <div style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                        </div>
                      ))}
                    </div>

                    {sale.data.pvImposeApplied && (
                      <p style={{ marginTop: 12, padding: '8px 12px', background: '#fff7ed', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 12 }}>
                        <strong>PV imposé appliqué</strong> — les lignes non forcées ont été ajustées d&apos;un
                        coefficient <strong>×{sale.data.coeffAjustement}</strong> pour atteindre le total demandé.
                        Le déboursé et le prix de revient sont inchangés : seule la marge s&apos;ajuste.
                      </p>
                    )}
                  </div>
                );
              })()}

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
                // Les frais SÉPARÉS s'ajoutent au PV des lignes : sans eux, le Total HT de
                // l'aperçu ne collerait pas au devis réel (ils ne sont pas dans les lignes).
                const baseFraisSepares = (sale.data?.fraisDetail ?? []).reduce(
                  (acc, f) => acc + Number(f.montant), 0,
                );
                const baseAvantRemise = basePvBrut + baseFraisSepares;
                const baseTotalHt = baseAvantRemise * remiseFraction;
                const baseRemise = baseAvantRemise - baseTotalHt;
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
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn-secondary" onClick={downloadPdf} disabled={!versionId}>Télécharger le PDF</button>
                        <button className="btn-secondary" onClick={downloadBordereau} disabled={!versionId}
                          title="Édition d'appel d'offre : structure et quantités, prix à compléter">
                          Bordereau PDF
                        </button>
                        <button className="btn-secondary" onClick={() => exportDpgf(false)} disabled={!versionId}
                          title="Même bordereau au format Excel : le destinataire saisit ses prix dans les colonnes vides">
                          Bordereau Excel
                        </button>
                        <button className="btn-secondary" onClick={() => exportDpgf(true)} disabled={!versionId}
                          title="Décomposition du prix global et forfaitaire, avec les prix">
                          DPGF Excel
                        </button>
                        <button className="btn" onClick={sendByMail} disabled={!versionId}
                          title={affaireDetail.data?.affaire?.client?.email
                            ? `Préparer un mail à ${affaireDetail.data.affaire.client.email}`
                            : "Aucune adresse client : le mail s'ouvrira sans destinataire"}>
                          ✉ Envoyer par mail
                        </button>
                      </div>
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
                            {/* Chaque poste de frais SÉPARÉ apparaît sous son propre intitulé. */}
                            {(sale.data?.fraisDetail ?? []).map((fd, i) => (
                              <div key={`${fd.designation}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                <span className="muted">{fd.designation || 'Frais'}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{e(fd.montant)}</span>
                              </div>
                            ))}
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

            <aside ref={synthPanelRef} className="synthese-panel" data-panel="2">
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                <button type="button" className="btn-ghost"
                  title={synthPinned ? 'Détacher : repasse en panneau flottant' : 'Épingler : garder affiché et réajuster la mise en page'}
                  onClick={() => { if (synthPinned) { setSynthPinned(false); setSynthFloatOpen(true); } else { setSynthPinned(true); setSynthFloatOpen(false); } }}
                  style={{ fontSize: 11, fontWeight: 600, color: synthPinned ? 'var(--primary)' : 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  📌 {synthPinned ? 'Épinglé' : 'Épingler'}
                </button>
                {!synthPinned && (
                  <button type="button" className="btn-ghost" title="Fermer" onClick={() => setSynthFloatOpen(false)}
                    style={{ fontSize: 14, lineHeight: 1, color: 'var(--muted)' }}>✕</button>
                )}
              </div>
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
                  {Number(sale.data?.fraisAnnexesIntegres) > 0.001 && (
                    <div className="synthese-row" style={{ color: '#d97706' }}>
                      <span className="lbl">dont frais noyés dans les PV</span>
                      <span className="val">{e(sale.data?.fraisAnnexesIntegres)}</span>
                    </div>
                  )}
                  {Number(sale.data?.fraisAnnexes) > 0.001 && (
                    <div className="synthese-row" style={{ color: '#d97706' }}><span className="lbl">+ Frais annexes séparés</span><span className="val">{e(sale.data?.fraisAnnexes)}</span></div>
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
                  <div className="synthese-row"><span className="lbl">PV brut HT</span><span className="val">{e(sale.data?.pvHorsFrais)}</span></div>
                  {(sale.data?.fraisDetail ?? []).map((fd, i) => (
                    <div key={`${fd.designation}-${i}`} className="synthese-row">
                      <span className="lbl">{fd.designation || 'Frais'}</span>
                      <span className="val">{e(fd.montant)}</span>
                    </div>
                  ))}
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
              {/* Total des frais annexes = postes séparés + postes noyés dans les prix. La ligne
                  doit refléter la charge RÉELLE de frais du devis, pas seulement la part visible. */}
              {(() => {
                const sep = Number(sale.data?.fraisAnnexes ?? 0);
                const noyes = Number(sale.data?.fraisAnnexesIntegres ?? 0);
                const total = sep + noyes;
                return (
                  <div className="synthese-row">
                    <span className="lbl">
                      Frais annexes
                      {total > 0.005 && (sep > 0.005 && noyes > 0.005) && (
                        <span className="muted" style={{ fontSize: 9, display: 'block', lineHeight: 1.3 }}>
                          dont {e(sep)} séparés · {e(noyes)} noyés
                        </span>
                      )}
                      {total > 0.005 && noyes > 0.005 && sep <= 0.005 && (
                        <span className="muted" style={{ fontSize: 9, display: 'block', lineHeight: 1.3 }}>
                          noyés dans les prix
                        </span>
                      )}
                    </span>
                    <span className="val">{e(total)}</span>
                  </div>
                );
              })()}
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

      {devisSettings && d && (
        <DevisSettingsModal
          devis={d}
          pending={saveDevisSettings.isPending}
          onClose={() => setDevisSettings(false)}
          onSave={(v) => { setErr(null); saveDevisSettings.mutate(v); }}
        />
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

/* ─────────── Paramètres du devis ─────────── */

function DevisSettingsModal({ devis, pending, onClose, onSave }: {
  devis: DevisDetail['devis'];
  pending: boolean;
  onClose: () => void;
  onSave: (v: {
    numero: string; designation: string; type: string;
    responsable: string; priorite: string; dateDebut: string; dateEcheance: string;
  }) => void;
}) {
  const iso = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
  const [f, setF] = useState({
    numero: devis.numero ?? '',
    designation: devis.designation ?? '',
    type: devis.type ?? 'principal',
    responsable: devis.responsable ?? '',
    priorite: devis.priorite ?? 'normale',
    dateDebut: iso(devis.date_debut),
    dateEcheance: iso(devis.date_echeance),
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 3, display: 'block' };
  const input: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13 };
  const Field = ({ l, children }: { l: string; children: React.ReactNode }) => (
    <div style={{ flex: 1, minWidth: 0 }}><span style={label}>{l}</span>{children}</div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div className="card" onClick={(ev) => ev.stopPropagation()} style={{ width: 'min(560px, 96vw)', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Paramètres du devis</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 2 }}>
          Identité du devis et informations de pilotage. Le numéro est attribué automatiquement
          à la création, mais reste modifiable ici.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field l="Numéro">
              <input style={{ ...input, fontFamily: 'monospace' }} value={f.numero}
                onChange={(ev) => set('numero', ev.target.value)} placeholder="DEV-2026-0001" />
            </Field>
            <Field l="Type">
              <select style={input} value={f.type} onChange={(ev) => set('type', ev.target.value)}>
                <option value="principal">Principal</option>
                <option value="lot">Lot</option>
                <option value="avenant">Avenant</option>
              </select>
            </Field>
          </div>
          <Field l="Désignation">
            <input style={input} value={f.designation} onChange={(ev) => set('designation', ev.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field l="Responsable">
              <input style={input} value={f.responsable} onChange={(ev) => set('responsable', ev.target.value)} />
            </Field>
            <Field l="Priorité">
              <select style={input} value={f.priorite} onChange={(ev) => set('priorite', ev.target.value)}>
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="urgente">Urgente</option>
                <option value="critique">Critique</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field l="Date de début">
              <input type="date" style={input} value={f.dateDebut} onChange={(ev) => set('dateDebut', ev.target.value)} />
            </Field>
            <Field l="Date d'échéance">
              <input type="date" style={input} value={f.dateEcheance} onChange={(ev) => set('dateEcheance', ev.target.value)} />
            </Field>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn" disabled={pending || !f.designation.trim()} onClick={() => onSave(f)}>
            {pending ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
