'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Save, ChevronUp } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme, type AppTheme } from '@/lib/theme';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';
import { IconBtn } from '@/components/IconBtn';
import { CompanySearch } from '@/components/CompanySearch';

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
interface Code { id: string; code: string; label: string; famille_id: string; nature: string; categorie?: string; famille_code?: string; famille_label?: string }

const NAT_OPTS = [
  { v: 'material', l: 'Matériaux' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];
const natLabel = (v: string) => NAT_OPTS.find((n) => n.v === v)?.l ?? v;

/**
 * Catégorie d'un code analytique — l'équivalent de l'A.R.C. typée charges ou produits.
 * C'est elle qui décide du bloc dans lequel le poste tombe au budget du chantier, et donc de la
 * possibilité d'y lire un résultat brut et un résultat net.
 */
const CAT_OPTS = [
  { v: 'charge', l: 'Charge' },
  { v: 'frais_generaux', l: 'Frais généraux' },
  { v: 'produit', l: 'Produit (recette)' },
];
const catLabel = (v?: string) => CAT_OPTS.find((c) => c.v === (v ?? 'charge'))?.l ?? 'Charge';
interface Company { id: string; code: string; name: string; has_logo?: boolean; address?: string; postal_code?: string; city?: string; phone?: string; email?: string; legal_form?: string; siret?: string; vat_intra?: string; rcs?: string; capital?: string }
interface Preferences { id: string; taux_fg_default: string; taux_ben_default: string; devis_prefix: string; devis_separator: string; devis_numero_annee?: boolean; devis_numero_digits?: number; mail_devis_objet?: string; mail_devis_corps?: string; couleur_principale: string; couleur_accent: string; taux_tva: number[]; default_tab: string; nb_decimales: number }

/* ─────────── tabs ─────────── */

const TABS = ['Entreprise', 'Numérotation', 'Listes de valeurs', 'Sécurité', 'Types de déboursé', 'Familles', 'Codes analytiques', 'Lots', 'Unités', 'Doublons', 'Préférences'] as const;
type Tab = typeof TABS[number];

/** Onglets propres à la société : ce qui ne dépend d'aucun module métier. */
export const ONGLETS_SOCIETE: Tab[] = ['Entreprise', 'Numérotation', 'Listes de valeurs', 'Sécurité', 'Préférences'];

/** Onglets propres au chiffrage : ce qui n'intéresse que l'étude de prix. */
export const ONGLETS_ETUDE: Tab[] = ['Types de déboursé'];

/**
 * Le PLAN ANALYTIQUE (natures → lots → familles → codes) reste une référence UNIQUE de la société.
 * C'est lui qui permet de comparer le prévu de l'étude au réalisé du chantier : deux plans séparés
 * n'auraient plus de colonne commune, et le contrôle de gestion perdrait son axe.
 *
 * Ce que chaque module gagne, c'est l'ACCÈS : on paramètre son référentiel depuis là où l'on
 * travaille, sans passer par la Configuration. Les écrans sont les mêmes, les données aussi.
 */
export const ONGLETS_PLAN_ANALYTIQUE: Tab[] = ['Familles', 'Codes analytiques', 'Lots', 'Unités', 'Doublons'];

/* ═══════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export function ParametresView({
  onglets = TABS as readonly Tab[],
  titre = 'Paramètres',
  sousTitre = 'Configuration de votre entreprise et référentiels',
  note,
}: {
  /** Sous-ensemble d'onglets à présenter — permet à chaque module d'exposer les siens. */
  onglets?: readonly Tab[];
  titre?: string;
  sousTitre?: string;
  /** Précision affichée sous le titre (ex. le partage du plan analytique). */
  note?: string;
} = {}) {
  const [tab, setTab] = useState<Tab>(onglets[0]);
  const { token } = useAuth();

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      <h1 style={{ margin: '0 0 4px' }}>{titre}</h1>
      <p className="muted" style={{ margin: '0 0 8px' }}>{sousTitre}</p>
      {note && (
        <p className="muted" style={{ margin: '0 0 20px', fontSize: 12, maxWidth: 640 }}>{note}</p>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {onglets.map((t) => (
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
      {token && tab === 'Numérotation' && <TabNumerotation />}
      {token && tab === 'Listes de valeurs' && <TabListes />}
      {token && tab === 'Sécurité' && <TabSecurite />}
      {token && tab === 'Types de déboursé' && <TabDebourseTypes token={token} />}
      {token && tab === 'Familles' && <TabFamilles token={token} />}
      {token && tab === 'Codes analytiques' && <TabCodes token={token} />}
      {token && tab === 'Lots' && <TabLots token={token} />}
      {token && tab === 'Unités' && <TabUnites token={token} />}
      {token && tab === 'Doublons' && <TabDoublons />}
      {token && tab === 'Préférences' && <TabPreferences token={token} />}
      {!token && <p className="muted">Chargement…</p>}
    </div>
  );
}

/* ─────────── Logo d'entreprise (éditions PDF) ─────────── */

function CompanyLogo({ companyId, hasLogo, token }: { companyId: string; hasLogo: boolean; token: string }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cache-buster : l'URL doit changer après un remplacement, sinon le navigateur garde l'ancien.
  const [stamp, setStamp] = useState(() => Date.now());

  const upload = async (file: File) => {
    setErr(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setErr('Utilisez un fichier PNG ou JPEG.'); return;
    }
    if (file.size > 1024 * 1024) {
      setErr('Logo trop volumineux (1 Mo maximum).'); return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(new Error('Lecture impossible'));
        r.readAsDataURL(file);
      });
      await apiFetch(`/params/company/${companyId}/logo`, { method: 'PUT', body: { data, mime: file.type }, token });
      setStamp(Date.now());
      qc.invalidateQueries({ queryKey: ['params-company'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiFetch(`/params/company/${companyId}/logo`, { method: 'DELETE', token });
      qc.invalidateQueries({ queryKey: ['params-company'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
      <div style={{
        width: 150, height: 64, border: '1px dashed var(--border-strong)', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: 'var(--surface)', flexShrink: 0,
      }}>
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api-proxy/params/company/logo?v=${stamp}`} alt="Logo de l'entreprise"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span className="muted" style={{ fontSize: 10 }}>Aucun logo</span>
        )}
      </div>
      <div>
        <div className="label" style={{ marginBottom: 4 }}>Logo (éditions PDF)</div>
        <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
          Affiché en haut de vos devis. PNG ou JPEG, 1 Mo maximum.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="btn-secondary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '…' : hasLogo ? 'Remplacer' : 'Choisir un fichier'}
            <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </label>
          {hasLogo && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={remove}>Retirer</button>
          )}
        </div>
        {err && <p style={{ color: 'var(--danger)', fontSize: 11, margin: '6px 0 0' }}>{err}</p>}
      </div>
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
        <CompanyLogo companyId={company.id} hasLogo={Boolean(company.has_logo)} token={token} />
        <div style={{ marginBottom: 8, maxWidth: 460 }}>
          <CompanySearch
            onSelect={(c) => setForm((prev) => ({
              ...prev,
              name: c.name,
              legal_form: c.legalForm ?? prev.legal_form,
              address: c.address ?? prev.address,
              postal_code: c.postalCode ?? prev.postal_code,
              city: c.city ?? prev.city,
              siret: c.siret ?? prev.siret,
              vat_intra: c.vatIntra ?? prev.vat_intra,
            }))}
          />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Sélectionnez votre entreprise pour préremplir les champs ci-dessous, puis enregistrez.
          </p>
        </div>

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


interface GroupeDoublon {
  type: 'lot' | 'famille' | 'code';
  libelle: string;
  entrees: Array<{ id: string; code: string; label: string; usages: number }>;
}

const TYPE_LABEL: Record<string, string> = {
  lot: 'Lot', famille: 'Famille', code: 'Code analytique',
};

/**
 * Doublons DÉJÀ en place — ceux que la garde à l'écriture n'a pas pu empêcher.
 *
 * Un code analytique en double fausse l'agrégation : la même dépense se répartit sur deux lignes.
 * Fusionner réaffecte tout ce qui pointait sur le doublon (ressources, commandes, factures,
 * pointages) avant de le supprimer — d'où le nombre d'usages affiché, qui dit lequel garder.
 */
function TabDoublons() {
  const erreur = useErreurReferentiel();
  const qc = useQueryClient();
  const api = useApi();
  const { data: groupes = [], isLoading } = useQuery<GroupeDoublon[]>({
    queryKey: ['params-doublons'],
    queryFn: () => api('/params/doublons'),
  });

  const fusion = useMutation({
    mutationFn: (v: { type: string; gardeId: string; supprimeId: string }) =>
      api('/params/doublons/fusionner', { method: 'POST', body: v }),
    onError: erreur.onError,
    onSuccess: () => {
      erreur.onOk();
      // Tout le plan a pu bouger : on réinterroge large plutôt que de deviner.
      for (const k of ['params-doublons', 'params-codes', 'params-familles', 'params-lots']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erreur.err && <div className="error">{erreur.err}</div>}
      <p className="muted" style={{ margin: 0, fontSize: 12, maxWidth: 700 }}>
        Entrées qui désignent visiblement la même chose (même libellé, casse et accents ignorés).
        Gardez celle qui porte le plus d’usages : la fusion lui réaffecte les ressources, commandes,
        factures et pointages de l’autre, puis supprime le doublon.
      </p>

      {isLoading ? (
        <p className="muted" style={{ fontSize: 12 }}>Analyse du plan…</p>
      ) : groupes.length === 0 ? (
        <Card title="Aucun doublon">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Le plan analytique ne contient pas deux entrées de même libellé.
          </p>
        </Card>
      ) : (
        groupes.map((g) => (
          <Card key={`${g.type}-${g.libelle}`} title={`${TYPE_LABEL[g.type] ?? g.type} — « ${g.libelle} »`}>
            <table className="grid">
              <thead>
                <tr><th>Code</th><th>Désignation</th><th style={{ textAlign: 'right' }}>Usages</th><th /></tr>
              </thead>
              <tbody>
                {g.entrees.map((e) => (
                  <tr key={e.id}>
                    <td className="code-cell">{e.code}</td>
                    <td>{e.label}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.usages}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-secondary btn"
                        style={{ padding: '2px 10px', fontSize: 10.5 }}
                        disabled={fusion.isPending}
                        title={`Garder « ${e.label} » et y fusionner les autres`}
                        onClick={() => {
                          const autres = g.entrees.filter((x) => x.id !== e.id);
                          const noms = autres.map((x) => `${x.code} (${x.usages} usage(s))`).join(', ');
                          if (!confirm(
                            `Garder « ${e.label} » (${e.code}) et y fusionner : ${noms} ?\n\n`
                            + `Les rattachements seront réaffectés, puis les doublons supprimés. Action définitive.`,
                          )) return;
                          erreur.onOk();
                          for (const a of autres) {
                            fusion.mutate({ type: g.type, gardeId: e.id, supprimeId: a.id });
                          }
                        }}
                      >
                        Garder celle-ci
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}

/**
 * Erreur d'écriture d'un onglet de référentiel.
 *
 * Le plan analytique refuse les doublons côté serveur (409). Sans ce relais, l'utilisateur
 * cliquerait « Ajouter » sans rien voir se passer : le garde-fou serait invisible, donc inutile.
 */
function useErreurReferentiel() {
  const [err, setErr] = useState<string | null>(null);
  return {
    err,
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'Opération impossible.'),
    onOk: () => setErr(null),
  };
}

function TabLots({ token }: { token: string }) {
  const erreur = useErreurReferentiel();
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
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setNewCode(''); setNewLabel(''); },
  });
  const update = useMutation({
    mutationFn: (e: typeof editing) => api(`/params/lots/${e!.id}`, { method: 'PATCH', body: { code: e!.code, label: e!.label } }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api<{ orphanedFamilles?: number }>(`/params/lots/${id}`, { method: 'DELETE' }),
    onSuccess: (res) => {
      inv();
      qc.invalidateQueries({ queryKey: ['params-familles'] });
      if (res?.orphanedFamilles && res.orphanedFamilles > 0) {
        alert(`Lot supprimé. ${res.orphanedFamilles} famille(s) ne sont plus rattachées à un lot — rattachez-les dans l'onglet Familles.`);
      }
    },
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/lots/${id}`, { method: 'DELETE' }))),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); qc.invalidateQueries({ queryKey: ['params-familles'] }); clear(); },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erreur.err && <div className="error">{erreur.err}</div>}
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
  const erreur = useErreurReferentiel();
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
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setNf({ lotId: '', code: '', label: '', nature: 'material' }); },
  });
  const update = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => api(`/params/familles/${e.id}`, { method: 'PATCH', body: { lotId: e.lotId || null, code: e.code, label: e.label, nature: e.nature } }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api<{ orphanedCodes?: number }>(`/params/familles/${id}`, { method: 'DELETE' }),
    onSuccess: (res) => {
      inv();
      qc.invalidateQueries({ queryKey: ['params-codes'] });
      if (res?.orphanedCodes && res.orphanedCodes > 0) {
        alert(`Famille supprimée. ${res.orphanedCodes} code(s) analytique(s) ne sont plus rattachés — rattachez-les dans l'onglet Codes analytiques.`);
      }
    },
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/familles/${id}`, { method: 'DELETE' }))),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); qc.invalidateQueries({ queryKey: ['params-codes'] }); clear(); },
  });

  // Réaffectation en masse : lot et/ou nature
  const [bulkLot, setBulkLot] = useState('');
  const [bulkNature, setBulkNature] = useState('');
  const bulkAssign = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      if (bulkLot) body.lotId = bulkLot;
      if (bulkNature) body.nature = bulkNature;
      return Promise.all([...selectedIds].map((id) => api(`/params/familles/${id}`, { method: 'PATCH', body })));
    },
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); qc.invalidateQueries({ queryKey: ['params-codes'] }); clear(); setBulkLot(''); setBulkNature(''); },
  });

  const orphanFam = familles.filter((f) => !f.lot_id).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erreur.err && <div className="error">{erreur.err}</div>}
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
        {orphanFam > 0 && <OrphanBanner n={orphanFam} kind="famille" />}
        {selectedIds.size > 0 && (
          <BulkBar count={selectedIds.size} isPending={bulkDelete.isPending || bulkAssign.isPending}
            onDelete={() => { if (confirm(`Supprimer ${selectedIds.size} famille(s) ?`)) bulkDelete.mutate(); }}>
            <BulkSelect value={bulkLot} onChange={setBulkLot}>
              <option value="">Lot : inchangé</option>
              {lots.map((l) => <option key={l.id} value={l.id}>→ {l.code} — {l.label}</option>)}
            </BulkSelect>
            <BulkSelect value={bulkNature} onChange={setBulkNature}>
              <option value="">Nature : inchangée</option>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>→ {n.l}</option>)}
            </BulkSelect>
            <button
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              disabled={(!bulkLot && !bulkNature) || bulkAssign.isPending}
              onClick={() => bulkAssign.mutate()}>
              Appliquer
            </button>
          </BulkBar>
        )}
        <RefTable
          rows={familles.map((f) => [f.code, f.label, f.lot_code ? `${f.lot_code} — ${f.lot_label}` : '⚠ non rattaché', natLabel(f.nature)])}
          headers={['Code', 'Désignation', 'Lot parent', 'Nature']}
          ids={familles.map((f) => f.id)}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={() => toggleAll(familles.map((f) => f.id))}
          onEdit={(i) => setEditing({ id: familles[i].id, lotId: familles[i].lot_id || '', code: familles[i].code, label: familles[i].label, nature: familles[i].nature })}
          onDelete={(i) => { if (confirm('Supprimer cette famille ?')) del.mutate(familles[i].id); }}
        />
      </Card>
      {editing && (
        <Modal title="Modifier la famille" onClose={() => setEditing(null)}>
          <Field label="Lot parent">
            <select className="input" value={editing.lotId} onChange={(e) => setEditing({ ...editing, lotId: e.target.value })}>
              <option value="">— non rattaché —</option>
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
  const erreur = useErreurReferentiel();
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
  const [nf, setNf] = useState({ familleId: '', code: '', label: '', nature: 'material', categorie: 'charge' });
  const [editing, setEditing] = useState<
    { id: string; familleId: string; code: string; label: string; nature: string; categorie: string } | null
  >(null);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();

  const inv = () => qc.invalidateQueries({ queryKey: ['params-codes'] });

  // Quand on choisit une famille, pré-remplir la nature avec celle de la famille
  const onPickFamille = (familleId: string, setter: (n: string) => void) => {
    const fa = familles.find((x) => x.id === familleId);
    if (fa) setter(fa.nature);
  };

  const create = useMutation({
    mutationFn: () => api('/params/codes', { method: 'POST', body: { familleId: nf.familleId, code: nf.code, label: nf.label, nature: nf.nature, categorie: nf.categorie } }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setNf({ familleId: '', code: '', label: '', nature: 'material', categorie: 'charge' }); },
  });
  const update = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => api(`/params/codes/${e.id}`, { method: 'PATCH', body: { familleId: e.familleId || null, code: e.code, label: e.label, nature: e.nature, categorie: e.categorie } }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); setEditing(null); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/params/codes/${id}`, { method: 'DELETE' }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); },
  });
  const bulkDelete = useMutation({
    mutationFn: () => Promise.all([...selectedIds].map((id) => api(`/params/codes/${id}`, { method: 'DELETE' }))),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); clear(); },
  });

  // Réaffectation en masse : famille (la nature suit la famille)
  const [bulkFamille, setBulkFamille] = useState('');
  const bulkAssign = useMutation({
    mutationFn: () => {
      const fa = familles.find((x) => x.id === bulkFamille);
      const body = { familleId: bulkFamille, nature: fa ? fa.nature : undefined };
      return Promise.all([...selectedIds].map((id) => api(`/params/codes/${id}`, { method: 'PATCH', body })));
    },
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); inv(); clear(); setBulkFamille(''); },
  });

  const orphanCodes = codes.filter((c) => !c.famille_id).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erreur.err && <div className="error">{erreur.err}</div>}
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
          {/* Charges, frais généraux ou produits : c'est ce typage qui permet au chantier
              d'afficher un résultat, et pas seulement une pile de dépenses. */}
          <Field label="Catégorie">
            <select className="input" style={{ width: 160 }} value={nf.categorie} onChange={(e) => setNf({ ...nf, categorie: e.target.value })}>
              {CAT_OPTS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Field>
          <Field label="Code"><input className="input" style={{ width: 110 }} placeholder="Ex: 280" value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} /></Field>
          <Field label="Désignation"><input className="input" style={{ width: 240 }} placeholder="Ex: Colle carrelage" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()} disabled={!nf.familleId || !nf.code || !nf.label}>+ Ajouter</button>
        </Row>
      </Card>
      <Card title={`Codes analytiques${codes.length > 0 ? ` (${codes.length})` : ''}`}>
        {orphanCodes > 0 && <OrphanBanner n={orphanCodes} kind="code" />}
        {selectedIds.size > 0 && (
          <BulkBar count={selectedIds.size} isPending={bulkDelete.isPending || bulkAssign.isPending}
            onDelete={() => { if (confirm(`Supprimer ${selectedIds.size} code(s) analytique(s) ?`)) bulkDelete.mutate(); }}>
            <BulkSelect value={bulkFamille} onChange={setBulkFamille}>
              <option value="">Famille : inchangée</option>
              {familles.map((fa) => <option key={fa.id} value={fa.id}>→ {fa.code} — {fa.label}</option>)}
            </BulkSelect>
            <button
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              disabled={!bulkFamille || bulkAssign.isPending}
              onClick={() => bulkAssign.mutate()}>
              Appliquer (nature héritée)
            </button>
          </BulkBar>
        )}
        <RefTable
          rows={codes.map((c) => [c.code, c.label, c.famille_code ? `${c.famille_code} — ${c.famille_label}` : '⚠ non rattaché', natLabel(c.nature), catLabel(c.categorie)])}
          headers={['Code', 'Désignation', 'Famille', 'Nature', 'Catégorie']}
          ids={codes.map((c) => c.id)}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={() => toggleAll(codes.map((c) => c.id))}
          onEdit={(i) => setEditing({ id: codes[i].id, familleId: codes[i].famille_id || '', code: codes[i].code, label: codes[i].label, nature: codes[i].nature, categorie: codes[i].categorie ?? 'charge' })}
          onDelete={(i) => { if (confirm('Supprimer ce code analytique ?')) del.mutate(codes[i].id); }}
        />
      </Card>
      {editing && (
        <Modal title="Modifier le code analytique" onClose={() => setEditing(null)}>
          <Field label="Famille">
            <select className="input" value={editing.familleId}
              onChange={(e) => { const id = e.target.value; const fa = familles.find((x) => x.id === id); setEditing({ ...editing, familleId: id, nature: fa ? fa.nature : editing.nature }); }}>
              <option value="">— non rattaché —</option>
              {familles.map((fa) => <option key={fa.id} value={fa.id}>{fa.code} — {fa.label}</option>)}
            </select>
          </Field>
          <Field label="Nature">
            <select className="input" value={editing.nature} onChange={(e) => setEditing({ ...editing, nature: e.target.value })}>
              {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <Field label="Catégorie">
            <select className="input" value={editing.categorie} onChange={(e) => setEditing({ ...editing, categorie: e.target.value })}>
              {CAT_OPTS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
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

/* ─────────── Types de déboursé ─────────── */

interface DebourseType {
  id: string;
  code: string;
  label: string;
  baseNature: string;
  builtin: boolean;
  devisVersionId: string | null;
}

/** Les quatre natures qui portent la gestion en aval (budgets de chantier, analytique, compta). */
const BASE_NATURES = [
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'material', l: 'Matériaux' },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
] as const;

function TabDebourseTypes({ token }: { token: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { data: types = [] } = useQuery<DebourseType[]>({
    queryKey: ['debourse-types'],
    queryFn: () => api<DebourseType[]>('/debourse-types'),
    enabled: Boolean(token),
  });
  const [form, setForm] = useState({ code: '', label: '', baseNature: 'subcontract' });
  const [editing, setEditing] = useState<DebourseType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['debourse-types'] });
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Opération impossible.');

  const create = useMutation({
    mutationFn: () => api('/debourse-types', { method: 'POST', body: form }),
    onSuccess: () => { done(); setForm({ code: '', label: '', baseNature: 'subcontract' }); },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (t: DebourseType) =>
      api(`/debourse-types/${t.id}`, {
        method: 'PUT',
        body: { code: t.code, label: t.label, baseNature: t.baseNature },
      }),
    onSuccess: () => { done(); setEditing(null); },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/debourse-types/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: fail,
  });

  const natureLabel = (v: string) => BASE_NATURES.find((n) => n.v === v)?.l ?? v;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Types de déboursé${types.length > 0 ? ` (${types.length})` : ''}`}>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 11 }}>
          Vos postes de coût, tels qu’ils apparaissent sur les ressources, les ouvrages et la
          feuille de vente — chacun avec ses propres % FG et % bénéfice dans chaque devis. Le
          rattachement à une nature de base commande la suite : budgets de chantier, axe
          analytique, export comptable.
        </p>
        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Code</th>
              <th>Intitulé</th>
              <th style={{ width: 200 }}>Nature de rattachement</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td className="code-cell">{t.code}</td>
                <td>{t.label}</td>
                <td className="muted">{natureLabel(t.baseNature)}</td>
                <td style={{ textAlign: 'right', paddingRight: 8 }}>
                  <IconBtn title="Modifier" color="#64748b" onClick={() => setEditing(t)}>
                    <Pencil size={12} />
                  </IconBtn>
                  <IconBtn
                    title="Supprimer"
                    color="#dc2626"
                    onClick={() => {
                      if (confirm(`Supprimer le type « ${t.label} » ?`)) del.mutate(t.id);
                    }}
                  >
                    <Trash2 size={11} />
                  </IconBtn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row style={{ marginTop: 12 }}>
          <Field label="Code">
            <input className="input" style={{ width: 90 }} placeholder="STM" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Intitulé">
            <input className="input" style={{ width: 260 }} placeholder="ST Moyens" value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Nature de rattachement">
            <select className="input" style={{ width: 200 }} value={form.baseNature}
              onChange={(e) => setForm({ ...form, baseNature: e.target.value })}>
              {BASE_NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => create.mutate()}>
            + Ajouter
          </button>
        </Row>
      </Card>
      {editing && (
        <Modal title="Modifier le type de déboursé" onClose={() => setEditing(null)}>
          <Field label="Code">
            <input className="input" style={{ width: 100 }} value={editing.code}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
          </Field>
          <Field label="Intitulé">
            <input className="input" style={{ width: 300 }} value={editing.label}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
          </Field>
          <Field label="Nature de rattachement">
            <select className="input" style={{ width: 220 }} value={editing.baseNature}
              onChange={(e) => setEditing({ ...editing, baseNature: e.target.value })}>
              {BASE_NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
            </select>
          </Field>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Changer la nature de rattachement déplace ce poste dans les budgets et les tableaux
            analytiques des prochains chantiers ; les chantiers déjà lancés ne bougent pas.
          </p>
          <Row style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn" onClick={() => setEditing(null)}>Annuler</button>
            <button className="btn" onClick={() => update.mutate(editing!)}>Modifier</button>
          </Row>
        </Modal>
      )}
    </div>
  );
}

/* ─────────── Unités ─────────── */

function TabUnites({ token }: { token: string }) {
  const erreur = useErreurReferentiel();
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
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); qc.invalidateQueries({ queryKey: ['params-units'] }); setForm({ abrev: '', label: '' }); },
  });
  const update = useMutation({
    mutationFn: (u: Unit) => api(`/params/units/${u.id}`, { method: 'PATCH', body: { abrev: u.abrev, label: u.label } }),
    onError: erreur.onError,
    onSuccess: () => { erreur.onOk(); qc.invalidateQueries({ queryKey: ['params-units'] }); setEditing(null); },
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
      {erreur.err && <div className="error">{erreur.err}</div>}
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
                <td style={{ textAlign: 'center', padding: '0 4px' }}>
                  <IconBtn title="Monter" color="var(--muted)" onClick={() => i > 0 && moveUp.mutate(i)} disabled={i === 0}>
                    <ChevronUp size={13} />
                  </IconBtn>
                </td>
                <td className="code-cell">{u.abrev}</td>
                <td>{u.label}</td>
                <td style={{ textAlign: 'right', paddingRight: 8 }}>
                  <IconBtn title="Modifier" color="#64748b" onClick={() => setEditing(u)}>
                    <Pencil size={12} />
                  </IconBtn>
                  <IconBtn title="Supprimer" color="#dc2626" onClick={() => { if (confirm('Supprimer ?')) del.mutate(u.id); }}>
                    <Trash2 size={11} />
                  </IconBtn>
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
        devisNumeroAnnee: (form.devis_numero_annee ?? String(prefs?.devis_numero_annee ?? true)) === 'true',
        devisNumeroDigits: Number(form.devis_numero_digits ?? prefs?.devis_numero_digits ?? 4),
        mailDevisObjet: f('mail_devis_objet') || null,
        mailDevisCorps: f('mail_devis_corps') || null,
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
          <Field label="Année dans le numéro">
            <select className="input" style={{ width: 90 }}
              value={form.devis_numero_annee ?? String(prefs?.devis_numero_annee ?? true)}
              onChange={(e) => setForm({ ...form, devis_numero_annee: e.target.value })}>
              <option value="true">Oui</option>
              <option value="false">Non</option>
            </select>
          </Field>
          <Field label="Chiffres de la séquence">
            <input className="input" style={{ width: 60 }} type="number" min={1} max={8}
              value={form.devis_numero_digits ?? String(prefs?.devis_numero_digits ?? 4)}
              onChange={(e) => setForm({ ...form, devis_numero_digits: e.target.value })} />
          </Field>
        </Row>
        <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
          Les nouveaux devis reçoivent automatiquement le numéro suivant, ex.{' '}
          <strong>
            {`${f('devis_prefix') || 'DEV'}${f('devis_separator') || '-'}`}
            {(form.devis_numero_annee ?? String(prefs?.devis_numero_annee ?? true)) === 'true'
              ? `${new Date().getFullYear()}${f('devis_separator') || '-'}`
              : ''}
            {'1'.padStart(Number(form.devis_numero_digits ?? prefs?.devis_numero_digits ?? 4), '0')}
          </strong>. Un numéro saisi à la main est toujours respecté.
        </p>
      </Card>

      <Card title="Modèle de mail d'envoi de devis">
        <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
          Utilisé par le bouton « Envoyer par mail » de l&apos;aperçu du devis. Variables
          disponibles :{' '}
          {['{CLIENT}', '{DEVIS}', '{AFFAIRE}', '{MONTANT_HT}', '{MONTANT_TTC}', '{DATE}', '{SOCIETE}'].map((v) => (
            <code key={v} style={{ background: 'var(--surface)', padding: '1px 5px', borderRadius: 4, marginRight: 4, fontSize: 10 }}>{v}</code>
          ))}
        </p>
        <Field label="Objet">
          <input className="input" style={{ width: '100%' }} value={f('mail_devis_objet')}
            onChange={(e) => setForm({ ...form, mail_devis_objet: e.target.value })} />
        </Field>
        <Field label="Corps du message">
          <textarea className="input" rows={9} style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
            value={f('mail_devis_corps')}
            onChange={(e) => setForm({ ...form, mail_devis_corps: e.target.value })} />
        </Field>
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

      {/* ── Thème de l'interface ── */}
      <ThemeCard />

      <SaveButton onSave={() => save.mutate()} isPending={save.isPending} saved={saved} />
    </div>
  );
}

/* ─────────── Thème de l'interface ─────────── */

const THEMES: { value: AppTheme; label: string; desc: string; preview: string }[] = [
  {
    value: 'liquid-glass',
    label: 'Liquid Glass',
    desc: 'Surfaces translucides avec effet verre et dégradé coloré en fond',
    preview: 'linear-gradient(135deg, #ccd9ed 0%, #c2cfe8 40%, #cac4e8 100%)',
  },
  {
    value: 'classic',
    label: 'Classique clair',
    desc: 'Interface épurée sur fond blanc, sans effet de transparence',
    preview: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
  },
  {
    value: 'flat',
    label: 'Flat theme',
    desc: 'À plat et aéré, typographie fine, pastilles vives façon icônes d’application',
    preview: 'radial-gradient(120% 80% at 50% -10%, #ffffff 0%, #eef1f7 60%, #e7ebf3 100%)',
  },
];

/* ─────────── Sécurité : double authentification (2FA) ─────────── */

interface MfaSetup { secret: string; otpauthUri: string; qrDataUri: string }

function TabSecurite() {
  const api = useApi();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null); // configuration / re-configuration en cours
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null); // codes de secours (une fois)

  const { data: status } = useQuery<{ enabled: boolean }>({
    queryKey: ['mfa-status'], queryFn: () => api('/auth/mfa/status'),
  });

  const start = useMutation({
    mutationFn: () => api<MfaSetup>('/auth/mfa/setup', { method: 'POST' }),
    onSuccess: (d) => { setSetup(d); setErr(null); setRecovery(null); setCode(''); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const confirm = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', body: { code } }),
    onSuccess: (d) => { setRecovery(d.recoveryCodes); setSetup(null); setCode(''); setErr(null); qc.invalidateQueries({ queryKey: ['mfa-status'] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Code invalide.'),
  });

  return (
    <Card title="Double authentification (2FA)">
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Un second facteur au moment de la connexion : un code à 6 chiffres généré par une
        application d’authentification (Google Authenticator, Authy, Microsoft Authenticator…).
        La 2FA est <strong>obligatoire</strong> pour toutes les entreprises et ne peut pas être
        désactivée. Vous pouvez en revanche la <strong>reconfigurer</strong> si vous changez de
        téléphone.
      </p>
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}

      {/* Codes de secours fraîchement générés — affichés une seule fois. */}
      {recovery && (
        <div style={{ border: '1px solid var(--success)', borderRadius: 8, padding: 14, marginBottom: 12, background: '#f0fdf4' }}>
          <strong style={{ color: 'var(--success)' }}>✓ Double authentification configurée</strong>
          <p style={{ fontSize: 12, margin: '6px 0' }}>
            Conservez ces <strong>codes de secours</strong> en lieu sûr : ils permettent de vous
            reconnecter si vous perdez votre téléphone. Chacun ne sert qu’une fois.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '4px 24px', fontFamily: 'monospace', fontSize: 13, margin: '8px 0' }}>
            {recovery.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button className="btn-secondary btn" style={{ fontSize: 11 }} onClick={() => setRecovery(null)}>J’ai noté mes codes</button>
        </div>
      )}

      {!recovery && status?.enabled && !setup && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge success">Activée · obligatoire</span>
          <button className="btn-secondary btn" disabled={start.isPending} onClick={() => { setErr(null); start.mutate(); }}>
            {start.isPending ? '…' : 'Changer d’appareil'}
          </button>
        </div>
      )}

      {!recovery && !status?.enabled && !setup && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="badge" style={{ background: '#fef2f2', color: 'var(--danger, #dc2626)' }}>Requise — non configurée</span>
          <button className="btn" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? '…' : 'Configurer maintenant'}
          </button>
        </div>
      )}

      {!recovery && setup && (
        <div>
          <p style={{ fontSize: 12, margin: '0 0 8px' }}>
            <strong>1.</strong> Scannez ce QR code avec votre application d’authentification :
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUri} alt="QR code de configuration" width={200} height={200}
            style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
          <p className="muted" style={{ fontSize: 11, margin: '8px 0' }}>
            Ou saisissez la clé manuellement : <code style={{ userSelect: 'all' }}>{setup.secret}</code>
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>2. Entrez le code affiché par l’application</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoFocus />
            </div>
            <button className="btn" disabled={!code || confirm.isPending} onClick={() => confirm.mutate()}>Vérifier et activer</button>
            {/* Annuler n'est proposé que pour une re-configuration (déjà activée) : on ne peut pas
                renoncer à une première configuration puisque la 2FA est obligatoire. */}
            {status?.enabled && (
              <button className="link" type="button" onClick={() => { setSetup(null); setErr(null); }}>Annuler</button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─────────── Numérotation automatique ─────────── */

interface Scheme { entityType: string; label: string; pattern: string; nextSeq: number; preview: string }

/** Aperçu client, miroir du moteur serveur (core/numbering/code-pattern.ts). */
function apercuCode(pattern: string, seq: number): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return pattern
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n: string) => String(seq).padStart(Number(n), '0'))
    .replace(/\{SEQ\}/g, String(seq));
}

function TabNumerotation() {
  const api = useApi();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { pattern: string; nextSeq: string }>>({});

  const { data: schemes = [], isLoading } = useQuery<Scheme[]>({
    queryKey: ['numbering'],
    queryFn: () => api('/numbering'),
  });

  const save = useMutation({
    mutationFn: (v: { type: string; pattern: string; nextSeq: number }) =>
      api(`/numbering/${v.type}`, { method: 'PATCH', body: { pattern: v.pattern, nextSeq: v.nextSeq } }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['numbering'] });
      setDrafts((d) => { const n = { ...d }; delete n[v.type]; return n; });
      setErr(null);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const draftOf = (s: Scheme) => drafts[s.entityType] ?? { pattern: s.pattern, nextSeq: String(s.nextSeq) };
  const setDraft = (type: string, patch: Partial<{ pattern: string; nextSeq: string }>, base: Scheme) =>
    setDrafts((d) => ({ ...d, [type]: { ...(d[type] ?? { pattern: base.pattern, nextSeq: String(base.nextSeq) }), ...patch } }));

  return (
    <Card title="Numérotation automatique">
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Chaque code est attribué automatiquement à la création — plus aucune saisie manuelle.
        Jetons disponibles : <code>{'{YYYY}'}</code> <code>{'{YY}'}</code> <code>{'{MM}'}</code> <code>{'{DD}'}</code> et{' '}
        <code>{'{SEQ}'}</code> ou <code>{'{SEQ:n}'}</code> (numéro complété de zéros). Ex.{' '}
        <code>AFF-{'{YYYY}'}-{'{SEQ:4}'}</code> → <strong>AFF-{new Date().getFullYear()}-0001</strong>.
      </p>
      {err && <div className="error">{err}</div>}
      {isLoading ? <p className="muted">Chargement…</p> : (
        <table className="grid" style={{ marginTop: 6 }}>
          <thead><tr>
            <th>Objet</th><th>Motif</th><th style={{ width: 90 }}>Prochain n°</th><th>Aperçu</th><th style={{ width: 110 }} />
          </tr></thead>
          <tbody>
            {schemes.map((s) => {
              const d = draftOf(s);
              const seqN = Number(d.nextSeq) || 1;
              const modifie = d.pattern !== s.pattern || String(seqN) !== String(s.nextSeq);
              return (
                <tr key={s.entityType}>
                  <td style={{ fontWeight: 600 }}>{s.label}</td>
                  <td><input value={d.pattern} style={{ width: 200, fontFamily: 'monospace' }}
                    onChange={(e) => setDraft(s.entityType, { pattern: e.target.value }, s)} /></td>
                  <td><input value={d.nextSeq} inputMode="numeric" style={{ width: 70 }}
                    onChange={(e) => setDraft(s.entityType, { nextSeq: e.target.value.replace(/[^0-9]/g, '') }, s)} /></td>
                  <td className="code-cell">{apercuCode(d.pattern, seqN)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" disabled={!modifie || save.isPending}
                      onClick={() => save.mutate({ type: s.entityType, pattern: d.pattern.trim(), nextSeq: seqN })}>
                      Enregistrer
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        Les codes déjà attribués ne changent pas. Modifier « prochain n° » ne sert qu’à repartir d’une valeur précise.
      </p>
    </Card>
  );
}

/* ─────────── Listes de valeurs paramétrables ─────────── */

interface ListItem { id: string; label: string; sort_order: number }
const LISTES: { type: string; titre: string; hint: string }[] = [
  { type: 'payment_term', titre: 'Conditions de paiement', hint: 'Ex : 30 j fin de mois, acompte 30 %…' },
  { type: 'work_nature', titre: 'Nature des travaux', hint: 'Ex : Neuf, Rénovation, Réhabilitation…' },
  { type: 'work_lot', titre: 'Lots traités', hint: 'Ex : Peinture, Sols souples, Faux-plafonds…' },
];

function TabListes() {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Ces valeurs alimentent les listes déroulantes des fiches (affaire…) pour harmoniser la
        saisie et éviter les différences de frappe entre utilisateurs.
      </p>
      {LISTES.map((l) => <ListeCard key={l.type} type={l.type} titre={l.titre} hint={l.hint} />)}
    </div>
  );
}

function ListeCard({ type, titre, hint }: { type: string; titre: string; hint: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { data: items = [] } = useQuery<ListItem[]>({ queryKey: ['list', type], queryFn: () => api(`/params/lists/${type}`) });

  const invalide = () => qc.invalidateQueries({ queryKey: ['list', type] });
  const add = useMutation({
    mutationFn: (label: string) => api(`/params/lists/${type}`, { method: 'POST', body: { label } }),
    onSuccess: () => { invalide(); setDraft(''); setErr(null); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ajout impossible.'),
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; label: string }) => api(`/params/lists/items/${v.id}`, { method: 'PATCH', body: { label: v.label } }),
    onSuccess: invalide,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/params/lists/items/${id}`, { method: 'DELETE' }),
    onSuccess: invalide,
  });

  return (
    <Card title={titre}>
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {items.length === 0 && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Aucune valeur — ajoutez-en ci-dessous.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" defaultValue={it.label} style={{ flex: 1 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.label) rename.mutate({ id: it.id, label: v }); }} />
            <IconBtn title="Supprimer" color="var(--danger)" onClick={() => remove.mutate(it.id)}><Trash2 size={14} /></IconBtn>
          </div>
        ))}
      </div>
      <form style={{ display: 'flex', gap: 8, marginTop: 10 }}
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) add.mutate(draft.trim()); }}>
        <input className="input" placeholder={hint} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" type="submit" disabled={!draft.trim() || add.isPending}>+ Ajouter</button>
      </form>
    </Card>
  );
}

function ThemeCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card title="Thème de l'interface">
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 11 }}>
        Le thème est appliqué immédiatement et mémorisé dans votre navigateur.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {THEMES.map((t) => {
          const active = theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme(t.value)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10, padding: 14,
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10, background: active ? 'rgba(232, 85, 10, 0.04)' : '#fff',
                cursor: 'pointer', textAlign: 'left', width: 200,
                boxShadow: active ? '0 0 0 3px rgba(232,85,10,0.12)' : 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              {/* Mini aperçu */}
              <div style={{
                height: 56, borderRadius: 6, background: t.preview,
                border: '1px solid var(--border)', position: 'relative', overflow: 'hidden',
              }}>
                {t.value === 'liquid-glass' && (
                  <>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 32,
                      background: 'rgba(255,255,255,0.50)', backdropFilter: 'blur(6px)',
                      borderRight: '1px solid rgba(255,255,255,0.5)' }} />
                    <div style={{ position: 'absolute', left: 32, top: 0, right: 0, height: 16,
                      background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(6px)',
                      borderBottom: '1px solid rgba(255,255,255,0.5)' }} />
                  </>
                )}
                {t.value === 'classic' && (
                  <>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 32,
                      background: '#f1f5f9', borderRight: '1px solid #e2e8f0' }} />
                    <div style={{ position: 'absolute', left: 32, top: 0, right: 0, height: 16,
                      background: '#ffffff', borderBottom: '1px solid #e2e8f0' }} />
                  </>
                )}
                {t.value === 'flat' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 7,
                    alignItems: 'center', justifyContent: 'center' }}>
                    {['#007aff', '#34c759', '#ff9500', '#af52de'].map((c) => (
                      <div key={c} style={{ width: 16, height: 16, borderRadius: 5,
                        background: `linear-gradient(180deg, ${c}cc, ${c})`,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)' }} />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, color: active ? 'var(--accent)' : 'var(--text)', marginBottom: 3 }}>
                  {active && <span style={{ marginRight: 5 }}>✓</span>}{t.label}
                </div>
                <div className="muted" style={{ fontSize: 10, lineHeight: 1.4 }}>{t.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────── Shared components ─────────── */

/* ─────────── Bandeau d'alerte « éléments non rattachés » ─────────── */
function OrphanBanner({ n, kind }: { n: number; kind: 'famille' | 'code' }) {
  const label = kind === 'famille'
    ? `${n} famille${n > 1 ? 's ne sont' : ' n’est'} rattachée${n > 1 ? 's' : ''} à aucun lot`
    : `${n} code${n > 1 ? 's analytiques ne sont' : ' analytique n’est'} rattaché${n > 1 ? 's' : ''} à aucune famille`;
  const action = kind === 'famille' ? 'Modifiez-les pour choisir un lot parent.' : 'Modifiez-les pour choisir une famille.';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 12,
      background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6,
      color: '#9a3412', fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ fontSize: 15 }}>⚠</span>
      <span><strong>{label}.</strong> {action}</span>
    </div>
  );
}

/* ─────────── Barre d'actions groupées ─────────── */
function BulkBar({ count, onDelete, isPending, children }: {
  count: number;
  onDelete: () => void;
  isPending: boolean;
  /** Contrôles de réaffectation en masse (sélecteurs + bouton Appliquer). */
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', marginBottom: 12,
      background: 'var(--primary)', color: '#fff', borderRadius: 6, fontSize: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 700 }}>{count} sélectionné{count > 1 ? 's' : ''}</span>
      <div style={{ flex: 1 }} />
      {children}
      <button
        style={{ background: '#e53e3e', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, cursor: isPending ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: isPending ? 0.7 : 1 }}
        onClick={onDelete} disabled={isPending}>
        {isPending ? '…' : `Supprimer (${count})`}
      </button>
    </div>
  );
}

/** Petit select pour la barre d'actions groupées (style sombre). */
function BulkSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}>
      {children}
    </select>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ borderRadius: 8, padding: '16px 20px' }}>
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

  // Tri client : on trie des tuples {row, id, origIndex} pour conserver l'alignement
  // et passer l'index d'ORIGINE à onEdit/onDelete.
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const tuples = rows.map((row, i) => ({ row, id: ids?.[i], origIndex: i }));
  const sorted = applySort(tuples, sort, (t, key) => t.row[Number(key)]);

  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>Aucun élément.</p>;
  return (
    <table className="grid">
      <thead>
        <tr>
          {selectable && <th style={{ width: 36 }}><input type="checkbox" ref={cbRef} checked={allSelected} onChange={onToggleAll} /></th>}
          {headers.map((h, idx) => (
            <SortHeader key={h} label={h} colKey={String(idx)} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
          ))}
          <th style={{ width: 72 }}></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => {
          const id = t.id;
          const isSelected = id ? selectedIds?.has(id) : false;
          return (
            <tr key={t.origIndex} style={{ background: isSelected ? '#f0f4ff' : undefined }}>
              {selectable && id && <td><input type="checkbox" checked={isSelected} onChange={() => onToggle!(id)} /></td>}
              {t.row.map((cell, j) => <td key={j}>{cell}</td>)}
              <td style={{ textAlign: 'right', paddingRight: 8 }}>
                <IconBtn title="Modifier" color="#64748b" onClick={() => onEdit(t.origIndex)}>
                  <Pencil size={12} />
                </IconBtn>
                <IconBtn title="Supprimer" color="#dc2626" onClick={() => onDelete(t.origIndex)}>
                  <Trash2 size={11} />
                </IconBtn>
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
        <Save size={13} />
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
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-box" style={{ borderRadius: 10, padding: '24px 28px', minWidth: 380, maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>
  );
}
