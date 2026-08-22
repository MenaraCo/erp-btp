'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Lock, Plus, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Bouton, CarteKpi, EtatVide } from '@/components/ui';
import { Modale } from '@/components/Modale';
import { CodeAnalytique, SelectCodeAnalytique } from '@/components/SelectCodeAnalytique';
import { PanneauVentilation } from '@/components/PanneauVentilation';
import { BonsDeBudget } from '@/components/BonsDeBudget';

/* ─────────── types ─────────── */
type Metriques = Record<string, string>;
interface NoeudCode { id: string; code: string; label: string; metrics: Metriques }
interface NoeudFamille { id: string; code: string; label: string; metrics: Metriques; codes: NoeudCode[] }
interface NoeudLot { id: string; code: string; label: string; metrics: Metriques; familles: NoeudFamille[] }
interface NoeudNature { nature: string; label: string; metrics: Metriques; lots: NoeudLot[] }
interface LigneCode { id: string; code: string; label: string; famille?: string | null; metrics: Metriques }
interface PhotoBudget {
  id: string; niveau: string; niveauLabel: string; version: number; commentaire: string | null;
  fixed_at: string; auteur: string | null; en_vigueur: boolean;
  total_charges: string; total_frais_generaux: string; total_produits: string; resultat_net: string;
}
interface TableauBudgets {
  fixedAt: string | null;
  reference: { id: string; niveau: string; version: number; fixedAt: string; label: string } | null;
  charges: {
    label: string;
    natures: NoeudNature[];
    aVentiler: { code: string; label: string; metrics: Metriques };
    /** Postes imputés mais absents de l'arbre (codes sans famille). */
    horsPlan: LigneCode[];
    total: Metriques;
  };
  fraisGeneraux: {
    label: string;
    fraisChantier: { label: string; metrics: Metriques };
    lignes: LigneCode[];
    total: Metriques;
  };
  produits: {
    label: string;
    marches: { label: string; venteMarches: string; venteAvenants: string; metrics: Metriques };
    lignes: LigneCode[];
    total: Metriques;
  };
  resultatBrut: Metriques;
  resultatNet: Metriques;
  total: Metriques;
  enveloppe: { depassementsAssumes: string; apportsAvenants: string };
  heures: { label: string; lignes: LigneCode[]; total: Metriques };
}
interface AvenantOption { id: string; numero: number | string; designation?: string | null; total_ht: string }
interface RessourceBudget {
  id: string; code: string; label: string; unit: string | null; nature: string;
  codeAnalytiqueId: string | null; codeAnalytique: string | null;
  etude: string; mouvements: string; global: string;
}
interface Mouvement {
  id: string; date: string; type: string; libelle: string; motif: string | null;
  quantite: string; montant: string; transfer_group_id: string | null; created_at: string;
  code_analytique: string | null; code_label: string | null;
  ressource_code: string | null; ressource_label: string | null; auteur: string | null;
}

const NATURE_LABELS: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: "Main d'œuvre", site_overhead: 'Frais de chantier',
};

function dt(s: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function jour(s: string | null): string {
  return s ? new Date(s).toLocaleDateString('fr-FR') : '';
}
/** Une ligne à zéro partout n'apprend rien : on ne l'affiche pas. */
function porteUneValeur(m: Metriques): boolean {
  return ['etude', 'mouvements', 'global', 'initial'].some((k) => Number(m[k] ?? 0) !== 0);
}
/** Des heures se lisent avec une décimale : « 137,5 h », pas « 137,50 € ». */
function heures(v: string | undefined): string {
  return `${Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
}
function ecart(m: Metriques): number {
  return Number(m.global ?? 0) - Number(m.initial ?? 0);
}

/**
 * Les BUDGETS du chantier — l'enveloppe, séparée de l'étude qui la calcule.
 *
 * Quatre colonnes, quatre questions : ce que l'étude d'exécution a chiffré (budget calculé), ce
 * qu'on a saisi ou ripé depuis (mouvements), la cible du moment (global = étude + mouvements) et
 * la référence figée au départ (initial). L'écart global − initial dit en un chiffre si l'on
 * tient l'objectif ou si la cible a glissé.
 *
 * Le ripage est ici, pas dans l'étude : déplacer du budget d'une ressource vers une autre ne
 * réécrit pas ce qu'on avait prévu — on doit toujours pouvoir dire ce qui était prévu.
 */
export default function BudgetsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [err, setErr] = useState<string | null>(null);
  const [saisie, setSaisie] = useState(false);
  const [ripage, setRipage] = useState(false);
  const [figer, setFiger] = useState(false);
  const [vue, setVue] = useState<'plat' | 'axe' | 'heures'>('plat');
  /** Photo de budget mise en regard ; vide = la dernière figée. */
  const [reference, setReference] = useState('');

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const budgets = useQuery({
    queryKey: ['budgets', chantierId, reference],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<TableauBudgets>(
      `/chantiers/${chantierId}/budgets${reference ? `?reference=${reference}` : ''}`, { token },
    ),
  });
  const photos = useQuery({
    queryKey: ['budgets-photos', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<PhotoBudget[]>(`/chantiers/${chantierId}/budgets/photos`, { token }),
  });
  const ressources = useQuery({
    queryKey: ['budgets-ressources', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<RessourceBudget[]>(`/chantiers/${chantierId}/budgets/ressources`, { token }),
  });
  const historique = useQuery({
    queryKey: ['budgets-historique', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Mouvement[]>(`/chantiers/${chantierId}/budgets/historique`, { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });
  // Les avenants du chantier : la façon ordinaire d'agrandir l'enveloppe, celle qui apporte
  // aussi la recette correspondante.
  const avenants = useQuery({
    queryKey: ['chantier-avenants', chantierId], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<AvenantOption[]>(`/chantiers/${chantierId}/avenants`, { token }),
  });

  /** Un mouvement de budget déplace la CIBLE : tout ce qui la lit doit se rafraîchir. */
  const rafraichir = () => {
    for (const key of [
      ['budgets', chantierId], ['budgets-ressources', chantierId], ['budgets-historique', chantierId],
      ['budgets-photos', chantierId],
      ['chantier-analytical', chantierId], ['chantier-results', chantierId],
      ['chantier-forecast', chantierId], ['pilotage', chantierId], ['a-ventiler', chantierId],
      ['portfolio'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const mSaisir = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/chantiers/${chantierId}/budgets/mouvements`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setSaisie(false); rafraichir(); }, onError: onErr,
  });
  const mRiper = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/chantiers/${chantierId}/budgets/ripages`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setRipage(false); rafraichir(); }, onError: onErr,
  });
  const mFiger = useMutation({
    mutationFn: (body: { niveau: string; commentaire: string | null }) =>
      apiFetch(`/chantiers/${chantierId}/budgets/photos`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); setFiger(false); rafraichir(); }, onError: onErr,
  });
  const mSupprimer = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/chantiers/${chantierId}/budgets/mouvements/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });

  const d = budgets.data;
  const t = d?.total;
  const ecartInitial = t ? Number(t.global) - Number(t.initial) : 0;
  const resultatNet = d ? Number(d.resultatNet.global) : 0;
  // Aucun poste typé « produit » : le chantier ne peut afficher aucun résultat. On le dit, et on
  // dit où le corriger — sinon le bloc reste vide sans qu'on sache pourquoi.
  const sansProduits = Boolean(d) && Number(d!.produits.total.global) === 0;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <h1 style={{ marginBottom: 4 }}>Budgets du chantier</h1>
          <p className="muted" style={{ marginTop: 0, maxWidth: 780 }}>
            Le compte de résultat du chantier, poste par poste : <strong>charges</strong> (calculées par l'étude
            d'exécution), <strong>frais généraux</strong> (repris de la feuille de vente du devis) et
            <strong> produits</strong> (le montant des marchés, moins le prorata et la retenue de garantie).
            Les <strong>mouvements</strong> sont ce que vous dotez, reprenez ou <strong>ripez</strong> ; le
            <strong> budget initial</strong> est la photo figée au départ.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton variante="secondaire" icone={Plus} onClick={() => { setErr(null); setSaisie(true); }}>
            Saisir un budget
          </Bouton>
          <Bouton variante="secondaire" icone={ArrowLeftRight} onClick={() => { setErr(null); setRipage(true); }}>
            Riper du budget
          </Bouton>
          <Bouton variante="primaire" icone={Lock} onClick={() => { setErr(null); setFiger(true); }}>
            Figer une photo
          </Bouton>
        </div>
      </div>

      {/* Ce qui attend une décision passe AVANT les chiffres : un budget qu'on lit sans savoir
          qu'il reste des lignes en attente est un budget qu'on lit faux. */}
      <BonsDeBudget chantierId={chantierId} />

      {err && <Alerte>{err}</Alerte>}
      {budgets.isError && (
        <p className="muted">
          {budgets.error instanceof ApiError && budgets.error.status === 403
            ? 'Suivi de chantiers non autorisé pour cet utilisateur.'
            : 'Chantier introuvable.'}
        </p>
      )}

      {d && t && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <CarteKpi titre="Produits" valeur={euro(d.produits.total.global)} icone={Wallet}
            detail={`Marchés ${euro(d.produits.marches.venteMarches)}${
              Number(d.produits.marches.venteAvenants) !== 0
                ? ` + avenants ${euro(d.produits.marches.venteAvenants)}` : ''}`} />
          <CarteKpi titre="Charges" valeur={euro(d.charges.total.global)}
            detail={`dont mouvements ${euro(d.charges.total.mouvements)}`} />
          <CarteKpi titre="Frais généraux" valeur={euro(d.fraisGeneraux.total.global)}
            detail="Repris du devis + saisies" />
          <CarteKpi
            titre="Résultat net"
            valeur={euro(d.resultatNet.global)}
            ton={resultatNet < 0 ? 'danger' : 'succes'}
            detail={`Brut ${euro(d.resultatBrut.global)} · ${
              d.reference
                ? `${d.reference.label} figé le ${dt(d.reference.fixedAt)}, écart ${euro(ecartInitial)}`
                : 'aucune photo de budget figée'
            }`}
          />
        </div>
      )}

      {d && Number(d.enveloppe.depassementsAssumes) !== 0 && (
        <Alerte ton="danger">
          <strong>{euro(d.enveloppe.depassementsAssumes)}</strong> de budget ajouté hors avenant
          (dépassements assumés). Cet argent ne vient d'aucune recette nouvelle : il se prend sur le
          résultat. {Number(d.enveloppe.apportsAvenants) !== 0 && (
            <>Les avenants, eux, ont apporté {euro(d.enveloppe.apportsAvenants)}.</>
          )}
        </Alerte>
      )}

      {d && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>Budgets par code analytique</h2>
            {/* Deux lectures du même tableau : à plat pour la synthèse (une ligne par poste,
                comme un compte de résultat), dépliable quand il faut savoir d'où vient un écart. */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {(photos.data ?? []).length > 0 && (
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <span className="muted">Comparer à</span>
                  <select value={reference} onChange={(e) => setReference(e.target.value)}>
                    <option value="">Dernière photo figée</option>
                    {(photos.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.niveauLabel} v{p.version} — {new Date(p.fixed_at).toLocaleDateString('fr-FR')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Bouton variante={vue === 'plat' ? 'primaire' : 'secondaire'} onClick={() => setVue('plat')}>
                Vue à plat
              </Bouton>
              <Bouton variante={vue === 'axe' ? 'primaire' : 'secondaire'} onClick={() => setVue('axe')}>
                Vue par axe analytique
              </Bouton>
              {d.heures.lignes.length > 0 && (
                <Bouton variante={vue === 'heures' ? 'primaire' : 'secondaire'} onClick={() => setVue('heures')}>
                  Budget d'heures
                </Bouton>
              )}
            </div>
          </div>

          {sansProduits && (
            <Alerte ton="info">
              Aucun poste n'est typé « Produit » : sans recette en face des dépenses, le résultat reste
              théorique. Typez vos codes (recettes, prorata, retenue de garantie) dans{' '}
              <Link href="/chantiers/parametres" className="link">Paramètres du plan analytique</Link>, onglet
              « Codes analytiques » : la colonne <strong>Catégorie</strong> les range en charge, frais général ou produit.
            </Alerte>
          )}

          {vue === 'heures' ? (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <p className="muted" style={{ marginTop: 0, fontSize: 12, maxWidth: 720 }}>
                L'enveloppe de main-d'œuvre en <strong>heures</strong> — la seule unité dans laquelle on sait
                dire si l'on tient le planning. Seuls les postes cochés « heures de production » y figurent.
              </p>
              <table className="grid" style={{ margin: 0, minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Poste</th>
                    <th style={{ textAlign: 'right' }}>Heures d'étude</th>
                    <th style={{ textAlign: 'right' }}>Mouvements</th>
                    <th style={{ textAlign: 'right' }}>Heures budgétées</th>
                  </tr>
                </thead>
                <tbody>
                  {d.heures.lignes.map((l) => (
                    <tr key={l.id}>
                      <td><span className="code-cell">{l.code}</span> {l.label}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{heures(l.metrics.heuresEtude)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(l.metrics.heuresMouvements ?? 0) === 0 ? '—' : heures(l.metrics.heuresMouvements)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {heures(l.metrics.heuresGlobal)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{heures(d.heures.total.heuresEtude)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{heures(d.heures.total.heuresMouvements)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{heures(d.heures.total.heuresGlobal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="grid" style={{ margin: 0, minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Poste</th>
                  <th style={{ textAlign: 'right' }}>Budget d'étude</th>
                  <th style={{ textAlign: 'right' }}>Mouvements</th>
                  <th style={{ textAlign: 'right' }}>Budget global</th>
                  <th style={{ textAlign: 'right' }}>
                    {d.reference ? `${d.reference.label} (${dt(d.reference.fixedAt).slice(0, 12)})` : 'Photo figée'}
                  </th>
                  <th style={{ textAlign: 'right' }}>Écart / photo</th>
                </tr>
              </thead>
              <tbody>
                {/* ─── Charges ─── */}
                <TitreSection titre="Charges" />
                {vue === 'axe'
                  ? d.charges.natures.filter((n) => porteUneValeur(n.metrics)).map((n) => (
                    <LignesNature key={n.nature} nature={n} />
                  ))
                  : codesAPlat(d.charges.natures).map((c) => (
                    <tr key={c.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <span className="code-cell">{c.code}</span> {c.label}
                      </td>
                      <Cellules m={c.metrics} />
                    </tr>
                  ))}
                {/* Un code sans famille est bel et bien ventilé : il se lit sous son nom, pas
                    dans « à ventiler » — sinon on cherche une erreur qui n'existe pas. */}
                {d.charges.horsPlan.map((l) => (
                  <tr key={l.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <span className="code-cell">{l.code}</span> {l.label}
                      <span className="muted" style={{ fontSize: 11 }}> — sans famille</span>
                    </td>
                    <Cellules m={l.metrics} />
                  </tr>
                ))}
                {porteUneValeur(d.charges.aVentiler.metrics) && (
                  <tr>
                    <td style={{ paddingLeft: 20 }}>
                      <span className="code-cell">{d.charges.aVentiler.code}</span> {d.charges.aVentiler.label}
                    </td>
                    <Cellules m={d.charges.aVentiler.metrics} />
                  </tr>
                )}
                <LigneTotal titre="Total charges" m={d.charges.total} />

                {/* ─── Frais généraux ─── */}
                <TitreSection titre="Frais généraux" />
                {porteUneValeur(d.fraisGeneraux.fraisChantier.metrics) && (
                  <tr>
                    <td style={{ paddingLeft: 20 }}>{d.fraisGeneraux.fraisChantier.label}</td>
                    <Cellules m={d.fraisGeneraux.fraisChantier.metrics} />
                  </tr>
                )}
                {d.fraisGeneraux.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <span className="code-cell">{l.code}</span> {l.label}
                    </td>
                    <Cellules m={l.metrics} />
                  </tr>
                ))}
                <LigneTotal titre="Total frais généraux" m={d.fraisGeneraux.total} />

                {/* ─── Produits ─── */}
                <TitreSection titre="Produits" />
                {porteUneValeur(d.produits.marches.metrics) && (
                  <tr>
                    <td style={{ paddingLeft: 20 }}>
                      {d.produits.marches.label}
                      <span className="muted" style={{ fontSize: 11 }}>
                        {' '}— repris des marchés, aucune saisie
                      </span>
                    </td>
                    <Cellules m={d.produits.marches.metrics} />
                  </tr>
                )}
                {d.produits.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <span className="code-cell">{l.code}</span> {l.label}
                    </td>
                    <Cellules m={l.metrics} />
                  </tr>
                ))}
                <LigneTotal titre="Total produits" m={d.produits.total} />

                {/* ─── Résultats ─── */}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td><strong>Résultat brut</strong>
                    <span className="muted" style={{ fontSize: 11 }}> — produits − charges</span>
                  </td>
                  <Cellules m={d.resultatBrut} gras resultat />
                </tr>
                <tr>
                  <td><strong>Résultat net</strong>
                    <span className="muted" style={{ fontSize: 11 }}> — après frais généraux</span>
                  </td>
                  <Cellules m={d.resultatNet} gras resultat />
                </tr>
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* Les photos : c'est la mémoire des cibles successives — ce qu'on visait à l'étude, après
          la contre-étude, et à chaque révision. Aucune n'est jamais écrasée. */}
      {(photos.data ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Photos de budget</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 780 }}>
              <thead>
                <tr>
                  <th>Niveau</th>
                  <th>Version</th>
                  <th>Figée le</th>
                  <th>Par</th>
                  <th>Commentaire</th>
                  <th style={{ textAlign: 'right' }}>Charges</th>
                  <th style={{ textAlign: 'right' }}>Frais généraux</th>
                  <th style={{ textAlign: 'right' }}>Produits</th>
                  <th style={{ textAlign: 'right' }}>Résultat net</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(photos.data ?? []).map((p) => (
                  <tr key={p.id} style={{ background: p.id === d?.reference?.id ? 'var(--surface)' : undefined }}>
                    <td>{p.niveauLabel}</td>
                    <td>
                      v{p.version}{' '}
                      {p.en_vigueur && <span className="badge success" style={{ fontSize: 10 }}>en vigueur</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{dt(p.fixed_at)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{p.auteur ?? ''}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{p.commentaire ?? ''}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(p.total_charges)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(p.total_frais_generaux)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(p.total_produits)}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: Number(p.resultat_net) < 0 ? 'var(--danger)' : undefined,
                    }}>
                      {euro(p.resultat_net)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Bouton variante="secondaire" onClick={() => setReference(p.id)}>Comparer</Bouton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Journal : un ripage sans trace est un ripage indéfendable trois mois plus tard. */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Historique des mouvements de budget</h2>
        {historique.data && historique.data.length === 0 ? (
          <EtatVide
            titre="Aucun mouvement de budget"
            indice="Le budget du chantier est celui de l'étude d'exécution, au centime près."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Poste</th>
                  <th>Libellé / motif</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th>Saisi le</th>
                  <th>Par</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {(historique.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{jour(m.date)}</td>
                    <td>
                      <span className={`badge ${m.type === 'ripage' ? 'warning' : 'info'}`}>
                        {m.type === 'ripage' ? 'Ripage' : 'Saisie'}
                      </span>
                    </td>
                    <td>
                      {m.code_analytique && <span className="code-cell">{m.code_analytique}</span>}{' '}
                      {m.ressource_label ?? m.code_label ?? ''}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.motif ?? m.libelle}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: Number(m.montant) < 0 ? 'var(--danger)' : undefined,
                    }}>
                      {euro(m.montant)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{dt(m.created_at)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.auteur ?? ''}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        title={m.transfer_group_id ? 'Annuler le ripage (les deux sens)' : 'Supprimer ce mouvement'}
                        onClick={() => mSupprimer.mutate(m.id)}
                        disabled={mSupprimer.isPending}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ranger ce qui est arrivé sans code se fait ici : c'est l'écran du budget analytique. */}
      <PanneauVentilation chantierId={chantierId} />

      {saisie && (
        <ModaleSaisie
          codes={codes.data ?? []}
          ressources={ressources.data ?? []}
          avenants={avenants.data ?? []}
          pending={mSaisir.isPending}
          erreur={err}
          onClose={() => setSaisie(false)}
          onSubmit={(body) => mSaisir.mutate(body)}
        />
      )}
      {ripage && (
        <ModaleRipage
          codes={codes.data ?? []}
          ressources={ressources.data ?? []}
          pending={mRiper.isPending}
          erreur={err}
          onClose={() => setRipage(false)}
          onSubmit={(body) => mRiper.mutate(body)}
        />
      )}
      {figer && (
        <ModaleFigeage
          global={t?.global ?? '0'}
          photos={photos.data ?? []}
          pending={mFiger.isPending}
          erreur={err}
          onClose={() => setFiger(false)}
          onSubmit={(body) => mFiger.mutate(body)}
        />
      )}
    </div>
  );
}

/* ─────────── lignes du tableau ─────────── */
/** Aplatit l'axe analytique en une liste de codes : la lecture synthétique, poste par poste. */
function codesAPlat(natures: NoeudNature[]): NoeudCode[] {
  return natures
    .flatMap((n) => n.lots)
    .flatMap((l) => l.familles)
    .flatMap((f) => f.codes)
    .filter((c) => porteUneValeur(c.metrics))
    .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
}

function TitreSection({ titre }: { titre: string }) {
  return (
    <tr style={{ background: 'var(--bg)' }}>
      <td colSpan={6} style={{ fontWeight: 700, letterSpacing: '.02em' }}>{titre}</td>
    </tr>
  );
}

function LigneTotal({ titre, m }: { titre: string; m: Metriques }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td><strong>{titre}</strong></td>
      <Cellules m={m} gras />
    </tr>
  );
}

function Cellules({ m, gras, resultat }: { m: Metriques; gras?: boolean; resultat?: boolean }) {
  const e = ecart(m);
  const style = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: gras ? 700 : undefined };
  // Sur une ligne de résultat, le rouge dit « on perd de l'argent » — pas « le chiffre est négatif ».
  const ton = (v: string | number) => (resultat && Number(v ?? 0) < 0 ? 'var(--danger)' : undefined);
  return (
    <>
      <td style={{ ...style, color: ton(m.etude) }}>{euro(m.etude ?? '0')}</td>
      <td style={{ ...style, color: resultat ? ton(m.mouvements) : Number(m.mouvements ?? 0) < 0 ? 'var(--danger)' : undefined }}>
        {Number(m.mouvements ?? 0) === 0 ? '—' : euro(m.mouvements)}
      </td>
      <td style={{ ...style, color: ton(m.global) }}>{euro(m.global ?? '0')}</td>
      <td style={style}>{Number(m.initial ?? 0) === 0 ? '—' : euro(m.initial)}</td>
      <td style={{ ...style, color: e < 0 ? 'var(--danger)' : undefined }}>
        {Number(m.initial ?? 0) === 0 ? '—' : euro(e)}
      </td>
    </>
  );
}

function LignesNature({ nature }: { nature: NoeudNature }) {
  return (
    <>
      <tr style={{ background: 'var(--bg)' }}>
        <td><strong>{NATURE_LABELS[nature.nature] ?? nature.label}</strong></td>
        <Cellules m={nature.metrics} />
      </tr>
      {nature.lots.filter((l) => porteUneValeur(l.metrics)).map((lot) => (
        <Fragment key={lot.id}>
          <tr>
            <td style={{ paddingLeft: 24 }}>{lot.label}</td>
            <Cellules m={lot.metrics} />
          </tr>
          {lot.familles.filter((f) => porteUneValeur(f.metrics)).map((fam) => (
            <Fragment key={fam.id}>
              <tr>
                <td style={{ paddingLeft: 44 }}>{fam.label}</td>
                <Cellules m={fam.metrics} />
              </tr>
              {fam.codes.filter((c) => porteUneValeur(c.metrics)).map((code) => (
                <tr key={code.id} className="muted">
                  <td style={{ paddingLeft: 64 }}>
                    <span className="code-cell">{code.code}</span> {code.label}
                  </td>
                  <Cellules m={code.metrics} />
                </tr>
              ))}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/* ─────────── figer une photo de budget ─────────── */
function ModaleFigeage({
  global, photos, pending, erreur, onClose, onSubmit,
}: {
  global: string;
  photos: PhotoBudget[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (body: { niveau: string; commentaire: string | null }) => void;
}) {
  const [niveau, setNiveau] = useState('etude');
  const [commentaire, setCommentaire] = useState('');
  const precedentes = photos.filter((p) => p.niveau === niveau);

  return (
    <Modale
      titre="Figer une photo de budget"
      sousTitre="Une référence de comparaison, datée et signée"
      largeur="m"
      onClose={onClose}
      actions={
        <Bouton chargement={pending} onClick={() => onSubmit({ niveau, commentaire: commentaire.trim() || null })}>
          Figer le budget global d'aujourd'hui
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <p style={{ marginTop: 0 }}>
        Le budget global actuel (<strong>{euro(global)}</strong>) est photographié tel quel — charges,
        frais généraux et produits compris.
      </p>
      <div className="field">
        <label>Niveau</label>
        <select value={niveau} onChange={(e) => setNiveau(e.target.value)}>
          <option value="etude">Budget d'étude</option>
          <option value="contre_etude">Budget de contre-étude</option>
          <option value="execution">Budget d'exécution</option>
        </select>
      </div>
      <div className="field">
        <label>Commentaire (facultatif)</label>
        <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
          placeholder="ex. budget arrêté après la contre-étude" />
      </div>
      {precedentes.length > 0 && (
        <Alerte ton="info">
          Ce niveau compte déjà {precedentes.length} photo{precedentes.length > 1 ? 's' : ''} : celle-ci
          deviendra la version {precedentes.length + 1}. Les précédentes restent consultables et
          comparables — rien n'est écrasé.
        </Alerte>
      )}
    </Modale>
  );
}

/* ─────────── saisie d'un budget ─────────── */
function ModaleSaisie({
  codes, ressources, avenants, pending, erreur, onClose, onSubmit,
}: {
  codes: CodeAnalytique[];
  ressources: RessourceBudget[];
  avenants: AvenantOption[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ressourceId, setRessourceId] = useState('');
  const [codeId, setCodeId] = useState<string | null>(null);
  const [libelle, setLibelle] = useState('');
  const [quantite, setQuantite] = useState('');
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [avenantId, setAvenantId] = useState('');

  const ressource = ressources.find((r) => r.id === ressourceId) ?? null;
  const codeEffectif = ressource?.codeAnalytiqueId ?? codeId;
  const dotation = Number(montant) > 0;
  const valide = Boolean(codeEffectif) && libelle.trim() !== '' && montant.trim() !== ''
    && Number(montant) !== 0
    // Une dotation sans avenant doit être motivée : c'est la contrepartie de son acceptation.
    && (!dotation || Boolean(avenantId) || motif.trim() !== '');

  return (
    <Modale
      titre="Saisir un budget"
      sousTitre="Charge, frais général ou recette — le code analytique choisi décide du bloc"
      largeur="m"
      onClose={onClose}
      actions={
        <Bouton
          disabled={!valide}
          chargement={pending}
          onClick={() =>
            onSubmit({
              date,
              ressourceId: ressourceId || null,
              codeAnalytiqueId: codeEffectif,
              libelle: libelle.trim(),
              quantite: quantite || '0',
              montant,
              motif: motif.trim() || null,
              avenantId: avenantId || null,
              depassementAssume: dotation && !avenantId,
            })
          }
        >
          Enregistrer le budget
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        Le montant est <strong>signé</strong> : positif pour une dotation ou une recette, négatif pour une
        reprise. Le <strong>compte prorata</strong> et la <strong>retenue de garantie</strong> se saisissent
        donc sur un code de type « produit », en négatif.
      </p>
      <Alerte ton="info">
        On ne crée pas de budget : une <strong>dotation</strong> doit dire d'où vient l'argent — d'un
        <strong> avenant</strong>, ou d'un <strong>dépassement assumé</strong> qui se prendra sur le
        résultat. Pour déplacer une enveloppe existante, utilisez plutôt <strong>Riper du budget</strong>.
      </Alerte>
      <div className="field">
        <label>Date de valeur</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Ressource (facultatif)</label>
        <select value={ressourceId} onChange={(e) => setRessourceId(e.target.value)}>
          <option value="">— Budget rattaché au code analytique seul —</option>
          {ressources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.label}{r.codeAnalytique ? ` (${r.codeAnalytique})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Code analytique {ressource && <span className="muted">— repris de la ressource</span>}</label>
        <SelectCodeAnalytique
          valeur={codeEffectif}
          codes={codes}
          obligatoire
          lecture={Boolean(ressource?.codeAnalytiqueId)}
          // Le budget est le seul écran à ouvrir les trois catégories : c'est ici qu'on saisit
          // une recette, un frais général ou une dotation de charges.
          categories={['charge', 'frais_generaux', 'produit']}
          onChange={(id) => setCodeId(id)}
        />
      </div>
      <div className="field">
        <label>Libellé</label>
        <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="ex. Enveloppe nettoyage de fin de chantier" />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Quantité (facultatif)</label>
          <input type="number" step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} style={{ textAlign: 'right' }} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Montant (€)</label>
          <input type="number" step="any" value={montant} onChange={(e) => setMontant(e.target.value)} style={{ textAlign: 'right' }} />
        </div>
      </div>
      {Number(montant) > 0 && (
        <>
          <div className="field">
            <label>D'où vient l'argent ?</label>
            <select value={avenantId} onChange={(e) => setAvenantId(e.target.value)}>
              <option value="">Dépassement assumé — pris sur le résultat</option>
              {avenants.map((a) => (
                <option key={a.id} value={a.id}>
                  Avenant n° {a.numero} — {euro(a.total_ht)}
                </option>
              ))}
            </select>
          </div>
          {!avenantId && (
            <span className="muted" style={{ fontSize: 11 }}>
              Sans avenant, le motif devient obligatoire : un dépassement anonyme est indéfendable.
            </span>
          )}
        </>
      )}
      <div className="field">
        <label>Motif {Number(montant) > 0 && !avenantId ? '(obligatoire)' : '(facultatif)'}</label>
        <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. sol impropre découvert au terrassement" />
      </div>
    </Modale>
  );
}

/* ─────────── ripage ─────────── */
function ModaleRipage({
  codes, ressources, pending, erreur, onClose, onSubmit,
}: {
  codes: CodeAnalytique[];
  ressources: RessourceBudget[];
  pending: boolean;
  erreur: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceId, setSourceId] = useState('');
  const [cibleId, setCibleId] = useState('');
  const [cibleCode, setCibleCode] = useState<string | null>(null);
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');

  const source = ressources.find((r) => r.id === sourceId) ?? null;
  const cible = ressources.find((r) => r.id === cibleId) ?? null;
  const dispo = source ? Number(source.global) : 0;
  const trop = source != null && montant.trim() !== '' && Number(montant) > dispo;
  const valide =
    source != null && (cible != null || cibleCode != null) &&
    montant.trim() !== '' && Number(montant) > 0 && !trop && motif.trim() !== '';

  return (
    <Modale
      titre="Riper du budget"
      sousTitre="Déplacer une enveloppe d'une ressource vers une autre — à somme nulle"
      largeur="l"
      onClose={onClose}
      actions={
        <Bouton
          disabled={!valide}
          chargement={pending}
          onClick={() =>
            onSubmit({
              date,
              sourceRessourceId: sourceId,
              cibleRessourceId: cibleId || null,
              cibleCodeAnalytiqueId: cibleId ? null : cibleCode,
              montant,
              motif: motif.trim(),
            })
          }
        >
          Riper {montant ? euro(montant) : ''}
        </Bouton>
      }
    >
      {erreur && <Alerte>{erreur}</Alerte>}
      <p className="muted" style={{ marginTop: 0 }}>
        Le budget global du chantier ne change pas : ce qui est repris ici est reporté là. Le mouvement est
        horodaté et signé — c'est ce qui le rend défendable en réunion de chantier.
      </p>
      <div className="field">
        <label>Date de valeur</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Reprendre sur (ressource)</label>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">— Choisir la ressource source —</option>
          {/* Une ressource sans budget ne peut rien donner : la proposer, c'est proposer une erreur. */}
          {ressources.filter((r) => Number(r.global) > 0).map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.label} — {euro(r.global)} disponibles
            </option>
          ))}
        </select>
        {source && (
          <span className="muted" style={{ fontSize: 11 }}>
            Budget disponible : {euro(source.global)} ({NATURE_LABELS[source.nature] ?? source.nature}
            {source.codeAnalytique ? ` · ${source.codeAnalytique}` : ''})
          </span>
        )}
      </div>
      <div className="field">
        <label>Reporter sur (ressource)</label>
        <select value={cibleId} onChange={(e) => setCibleId(e.target.value)}>
          <option value="">— Ou choisir un code analytique ci-dessous —</option>
          {ressources.filter((r) => r.id !== sourceId).map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.label}{r.codeAnalytique ? ` (${r.codeAnalytique})` : ''}
            </option>
          ))}
        </select>
      </div>
      {!cibleId && (
        <div className="field">
          <label>… ou code analytique cible</label>
          <SelectCodeAnalytique valeur={cibleCode} codes={codes} obligatoire onChange={setCibleCode} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Montant à riper (€)</label>
          <input type="number" step="any" min={0} value={montant} onChange={(e) => setMontant(e.target.value)} style={{ textAlign: 'right' }} />
          {trop && <span style={{ color: 'var(--danger)', fontSize: 11 }}>Au-delà du budget disponible ({euro(dispo)}).</span>}
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>Motif (obligatoire)</label>
          <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. moins de colle, plus d'adhésif" />
        </div>
      </div>
    </Modale>
  );
}
