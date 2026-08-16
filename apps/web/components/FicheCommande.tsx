'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, History, Lock, MessageSquarePlus, PackageCheck, ReceiptText, ShieldCheck,
  Trash2, Unlock,
} from 'lucide-react';
import { IconBtn } from '@/components/IconBtn';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { teinteChantier } from '@/components/CalendrierMois';
import { ApproModal } from '@/components/ApproModal';
import { LigneRapprochement, SaisieRapprochement } from '@/components/SaisieRapprochement';
import { BibliothequeCommandeModal } from '@/components/BibliothequeCommandeModal';
import { CodeAnalytique, SelectCodeAnalytique } from '@/components/SelectCodeAnalytique';

interface Ligne {
  id: string;
  nature: string;
  designation: string;
  quantity: string;
  unit_price: string;
  amount_ht: string;
  ouvrage: string | null;
  code_analytique: string | null;
  execution_line_id: string | null;
  code_analytique_id: string | null;
  ressource_code: string | null;
  code: string | null;
  kind: 'resource' | 'comment';
  sort_order: number;
  unite_achat: string | null;
  coeff_conversion: string | null;
  ref_fournisseur: string | null;
  code_produit: string | null;
  unite_emploi: string | null;
  pu_debourse: string | null;
}
interface Evenement {
  id: string; action: string; motif: string | null; created_at: string;
  auteur: string | null; auteur_email: string | null;
}
interface Rapprochement {
  lignes: LigneRapprochement[];
  receptionEtat: 'aucune' | 'partielle' | 'complete';
  factureEtat: 'aucune' | 'partielle' | 'complete';
  soldee: boolean;
  ecartPrixTotal: string;
}
interface Fournisseur { id: string; name: string }
interface Fiche {
  commande: {
    id: string; code: string; status: string; total_ht: string; validated_at: string | null;
    created_at: string; chantier_id: string; chantier_code: string | null; chantier_nom: string | null;
    chantier_couleur: string | null; fournisseur: string | null; reopened_count: number;
    supplier_id: string | null; delivery_address: string | null; delivery_date: string | null;
    delivery_conditions: string | null; payment_terms: string | null; contact: string | null;
    notes: string | null;
  };
  lignes: Ligne[];
  receptions: Array<{ id: string; code: string; received_at: string | null }>;
  factures: Array<{ id: string; code: string; nature: string; amount_ht: string; invoice_date: string | null }>;
}

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};
const STATUTS: Record<string, string> = {
  draft: 'Brouillon', pending_approval: 'À valider', validated: 'Envoyée', cancelled: 'Annulée',
};
const BADGE: Record<string, string> = {
  draft: 'info', pending_approval: 'warning', validated: 'success', cancelled: 'danger',
};
const ACTIONS: Record<string, string> = {
  submitted: 'Soumise à validation', approved: 'Approuvée', rejected: 'Refusée',
  validated: 'Envoyée au fournisseur', cancelled: 'Annulée', reopened: 'Rouverte',
  received: 'Réception enregistrée', invoiced: 'Facture enregistrée',
};

interface EtatValidation {
  requis: Array<{ validatorId: string; validateur: string; montantMin: string }>;
  manquants: Array<{ validatorId: string; validateur: string; montantMin: string }>;
  peutValider: boolean;
}
const ETATS: Record<string, string> = {
  aucune: 'rien', partielle: 'partielle', complete: 'complète',
};
const ETAT_BADGE: Record<string, string> = {
  aucune: 'info', partielle: 'warning', complete: 'success',
};
const NATURES_SAISIE = [
  { value: 'material', label: 'Matériaux' },
  { value: 'equipment', label: 'Matériel' },
  { value: 'subcontract', label: 'Sous-traitance' },
  { value: 'labor', label: 'Main d’œuvre' },
  { value: 'site_overhead', label: 'Frais de chantier' },
];

interface LigneExecution {
  id: string; code: string | null; designation: string; children?: LigneExecution[];
}
interface MarcheTree { lines: LigneExecution[] }
interface Arbre { marches: MarcheTree[] }

/** Ouvrages à plat, indentés — un sélecteur se lit mieux ainsi qu'un arbre. */
function aplatir(lignes: LigneExecution[], niveau = 0): Array<{ id: string; label: string }> {
  return lignes.flatMap((l) => [
    { id: l.id, label: `${'— '.repeat(niveau)}${l.code ? `${l.code} · ` : ''}${l.designation}` },
    ...aplatir(l.children ?? [], niveau + 1),
  ]);
}

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Fiche d'un bon de commande, sur sa propre page.
 *
 * Le détail d'une commande — cinquante lignes parfois — n'a rien à faire dans une liste dépliée :
 * on l'ouvre, on la lit, on revient. Les réceptions et les factures rattachées sont rappelées ici,
 * puisque c'est là qu'on vient vérifier ce qui reste à recevoir.
 */
/**
 * Bouton « i » : les informations techniques d'une ligne ne méritent pas six colonnes permanentes.
 * On les replie derrière un déclencheur, et le tableau garde la place pour ce qu'on lit vraiment —
 * la désignation, la quantité, le prix.
 */
function BoutonInfo({ ouvert, onClick }: { ouvert: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={ouvert ? 'Masquer les informations techniques' : 'Informations techniques (référence, conditionnement)'}
      onClick={onClick}
      style={{
        width: 18, height: 18, borderRadius: 9, cursor: 'pointer', lineHeight: 1,
        border: `1px solid ${ouvert ? 'var(--primary)' : 'var(--border)'}`,
        background: ouvert ? 'var(--primary)' : 'transparent',
        color: ouvert ? '#fff' : 'var(--muted)',
        fontSize: 11, fontWeight: 700, fontStyle: 'italic',
      }}
    >
      i
    </button>
  );
}

/**
 * Volet technique d'une ligne : référence fournisseur, code produit, conditionnement.
 *
 * Éditable en brouillon — y compris sur une ligne venue d'un catalogue : la commande est une
 * COPIE, et le fournisseur peut avoir changé de référence sans que le catalogue le sache encore.
 */
function InfosLigne({
  ligne,
  ouvrages,
  onChange,
}: {
  ligne: Ligne;
  ouvrages: Array<{ id: string; label: string }>;
  onChange?: (patch: Record<string, string | null>) => void;
}) {
  const lecture = !onChange;
  const champ = (
    label: string,
    valeur: string | null,
    cle: string,
    placeholder?: string,
    numerique = false,
  ) => (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {lecture
        ? <div style={{ fontSize: 13, padding: '4px 0' }}>{valeur || <span className="muted">—</span>}</div>
        : (
          <input
            type={numerique ? 'number' : 'text'}
            step={numerique ? '0.0001' : undefined}
            min={numerique ? 0 : undefined}
            defaultValue={valeur ?? ''}
            placeholder={placeholder}
            onBlur={(e) => e.target.value !== (valeur ?? '') && onChange!({ [cle]: e.target.value || null })}
          />
        )}
    </div>
  );

  const coeff = Number(ligne.coeff_conversion || 0);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
        FICHE RESSOURCE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Nature</label>
          {lecture
            ? <div style={{ fontSize: 13, padding: '4px 0' }}>{NATURES[ligne.nature] ?? ligne.nature}</div>
            : (
              <select
                defaultValue={ligne.nature}
                onChange={(e) => onChange!({ nature: e.target.value })}
              >
                {NATURES_SAISIE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            )}
        </div>
        <div className="field" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
          <label>Ouvrage imputé (facultatif)</label>
          {lecture
            ? <div style={{ fontSize: 13, padding: '4px 0' }}>{ligne.ouvrage || <span className="muted">—</span>}</div>
            : (
              <select
                defaultValue={ligne.execution_line_id ?? ''}
                onChange={(e) => onChange!({ executionLineId: e.target.value || null })}
              >
                <option value="">— Non réparti —</option>
                {ouvrages.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            )}
        </div>
        {champ('Référence fournisseur', ligne.ref_fournisseur, 'refFournisseur', 'Réf. au catalogue du fournisseur')}
        {champ('Code produit', ligne.code_produit, 'codeProduit', 'Code interne')}
        {champ('Unité d’achat', ligne.unite_achat, 'uniteAchat', 'sac, palette, ml…')}
        {champ('Coefficient de conversion', ligne.coeff_conversion, 'coeffConversion', '1', true)}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
        {coeff > 0 && ligne.unite_emploi
          ? `1 ${ligne.unite_achat ?? 'unité d’achat'} = ${coeff} ${ligne.unite_emploi}`
          : 'Le coefficient dit ce que contient une unité d’achat (1 sac = 25 kg).'}
        {ligne.pu_debourse && Number(ligne.pu_debourse) > 0
          && ` · Déboursé budgété : ${Number(ligne.pu_debourse).toFixed(4)} €/${ligne.unite_emploi ?? 'u'}`}
      </p>
    </div>
  );
}

/**
 * Bouton « + » d'ajout de ligne, calqué sur le montage d'un devis : un déclencheur, deux gestes.
 * `R` reprend une ressource déjà chiffrée, `L` ouvre une ligne libre — la cohérence entre modules
 * compte plus que l'originalité de chaque écran.
 */
function MenuAjout({ onRessource, onCatalogue, onLigneLibre, onCommentaire }: {
  onRessource: () => void;
  onCatalogue: () => void;
  onLigneLibre: () => void;
  onCommentaire: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const carre = (label: string, titre: string, couleur: string, action: () => void) => (
    <button
      type="button"
      title={titre}
      onClick={() => { action(); setOuvert(false); }}
      style={{
        width: 26, height: 22, borderRadius: 4, border: `1px solid ${couleur}`,
        background: 'transparent', color: couleur, fontSize: 11, fontWeight: 700,
        cursor: 'pointer', lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        title="Ajouter une ligne à cette commande"
        onClick={() => setOuvert((o) => !o)}
        style={{
          width: 22, height: 22, borderRadius: 4, border: '1px solid var(--primary)',
          background: 'transparent', color: 'var(--primary)', fontSize: 15, fontWeight: 700,
          cursor: 'pointer', lineHeight: 1,
        }}
      >
        +
      </button>
      {ouvert && (
        <>
          {carre('R', 'Reprendre des ressources BUDGÉTÉES sur ce chantier (quantités et reste à commander)',
            '#0891b2', onRessource)}
          {carre('B', 'Piocher dans la bibliothèque générale de l’entreprise (hors budget)',
            '#7c3aed', onCatalogue)}
          {carre('L', 'Ajouter une ligne libre, à remplir dans le tableau', '#64748b', onLigneLibre)}
          {carre('C', 'Ajouter une ligne de commentaire (sans quantité ni prix)', '#b45309', onCommentaire)}
          <span className="muted" style={{ fontSize: 11 }}>
            R : budget · B : bibliothèque · L : ligne libre · C : commentaire
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Fiche d'un bon de commande — le SEUL endroit où l'on agit sur une commande.
 *
 * Le même composant sert au registre d'entreprise et à l'intérieur d'un chantier : `retour` dit
 * simplement d'où l'on vient. Sans cela, ouvrir une commande depuis un chantier faisait sortir du
 * chantier — on perdait son contexte de travail pour une simple lecture.
 */
export function FicheCommande({
  orderId,
  retour,
}: {
  orderId: string;
  retour: { href: string; label: string };
}) {
  const { token } = useAuth();

  const qc = useQueryClient();
  const [motif, setMotif] = useState('');
  const [approOuvert, setApproOuvert] = useState(false);
  const [catalogueOuvert, setCatalogueOuvert] = useState(false);
  const [ligneOuverte, setLigneOuverte] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<null | 'reception' | 'facture'>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [ouvrirReouverture, setOuvrirReouverture] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fiche = useQuery({
    queryKey: ['commande', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Fiche>(`/purchase-orders/${orderId}`, { token }),
  });
  const rappro = useQuery({
    queryKey: ['commande-rapprochement', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Rapprochement>(`/purchase-orders/${orderId}/rapprochement`, { token }),
  });
  const fournisseurs = useQuery({
    queryKey: ['suppliers-filtre'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<{ rows: Fournisseur[] }>('/suppliers?sort=name&pageSize=100', { token }),
  });
  const validation = useQuery({
    queryKey: ['commande-validation', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<EtatValidation>(`/purchase-orders/${orderId}/approval`, { token }),
  });
  const journal = useQuery({
    queryKey: ['commande-journal', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Evenement[]>(`/purchase-orders/${orderId}/events`, { token }),
  });
  const rouvrir = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/reopen`, {
      method: 'POST', token, body: { motif },
    }),
    onSuccess: () => {
      setErr(null); setMotif(''); setOuvrirReouverture(false);
      qc.invalidateQueries({ queryKey: ['commande', orderId] });
      qc.invalidateQueries({ queryKey: ['commande-journal', orderId] });
      qc.invalidateQueries({ queryKey: ['achats-commandes'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Réouverture impossible.'),
  });
  const chantierId = fiche.data?.commande.chantier_id ?? '';
  const arbre = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token && chantierId),
    retry: false,
    queryFn: () => apiFetch<Arbre>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });
  const unites = useQuery({
    queryKey: ['params-units'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Array<{ id: string; abrev: string; label: string }>>('/params/units', { token }),
  });
  const plan = useQuery({
    queryKey: ['analytical-plan'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Array<{ lots: Array<{ familles: Array<{ codes: Array<{ id: string; code: string; label: string }> }> }> }>>(
      '/analytical/plan', { token },
    ),
  });
  const ouvrages = (arbre.data?.marches ?? []).flatMap((m) => aplatir(m.lines));
  // Le sélecteur montre le code seul une fois replié : l'intitulé n'apparaît qu'au déroulé.
  const codes: CodeAnalytique[] = (plan.data ?? []).flatMap((n) =>
    n.lots.flatMap((l) => l.familles.flatMap((fa) =>
      fa.codes.map((c) => ({ id: c.id, code: c.code, label: c.label })))));

  const rafraichir = () => {
    setErr(null);
    for (const key of ['commande', 'commande-journal', 'commande-validation', 'commande-rapprochement', 'achats-commandes', 'achats-receptions', 'achats-factures', 'purchasing-summary', 'execution-tree']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const echec = (e: unknown, defaut: string) =>
    setErr(e instanceof ApiError ? e.message : defaut);

  /**
   * Ligne libre : créée vide et remplie DANS la grille, comme un ouvrage libre au montage d'un
   * devis. Un formulaire séparé au-dessus du tableau obligeait à viser deux endroits à la fois.
   */
  const ajouterLigne = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/lines`, {
      method: 'POST', token,
      body: { nature: 'material', designation: 'Nouvelle ligne', quantity: '1', unitPrice: '0' },
    }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Ligne non ajoutée.'),
  });
  /**
   * Commentaire : il se pose JUSTE SOUS la ligne visée (rang + 1), là où on l'écrirait à la main
   * sur un bon de commande papier.
   */
  const ajouterCommentaire = useMutation({
    mutationFn: (apres?: { sortOrder: number }) => apiFetch(`/purchase-orders/${orderId}/lines`, {
      method: 'POST', token,
      body: {
        kind: 'comment',
        designation: 'Commentaire',
        ...(apres ? { sortOrder: apres.sortOrder + 1 } : {}),
      },
    }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Commentaire non ajouté.'),
  });
  // Envoyer, c'est SOUMETTRE : sous les seuils la commande part, au-delà elle passe au visa.
  const envoyer = useMutation({
    mutationFn: () => apiFetch<{ statut: string; validateurs: string[] }>(
      `/purchase-orders/${orderId}/submit`, { method: 'POST', token },
    ),
    onSuccess: (r) => {
      setInfo(r.statut === 'pending_approval'
        ? `En attente de validation : ${r.validateurs.join(', ')}.`
        : null);
      rafraichir();
    },
    onError: (e) => echec(e, 'Envoi impossible.'),
  });
  const approuver = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/approve`, { method: 'POST', token, body: {} }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Approbation impossible.'),
  });
  const refuser = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/reject`, {
      method: 'POST', token, body: { motif },
    }),
    onSuccess: () => { setMotif(''); rafraichir(); },
    onError: (e) => echec(e, 'Refus impossible.'),
  });
  const annuler = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/cancel`, { method: 'POST', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Annulation impossible.'),
  });
  const majEntete = useMutation({
    mutationFn: (patch: Record<string, string | null>) =>
      apiFetch(`/purchase-orders/${orderId}`, { method: 'PATCH', token, body: patch }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'En-tête non enregistré.'),
  });
  const majLigne = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, string | null> }) =>
      apiFetch(`/purchase-order-lines/${v.id}`, { method: 'PATCH', token, body: v.patch }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Ligne non modifiée.'),
  });
  const supprimerLigne = useMutation({
    mutationFn: (id: string) => apiFetch(`/purchase-order-lines/${id}`, { method: 'DELETE', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Ligne non supprimée.'),
  });

  const f = fiche.data;

  if (!f) {
    return (
      <div>
        <Link href={retour.href} className="link"><ArrowLeft size={13} /> {retour.label}</Link>
        <p className="muted" style={{ marginTop: 16 }}>
          {fiche.isError ? 'Commande introuvable.' : 'Chargement…'}
        </p>
      </div>
    );
  }

  const c = f.commande;
  const brouillon = c.status === 'draft';
  const envoyee = c.status === 'validated';
  const auVisa = c.status === 'pending_approval';
  const v = validation.data;
  const r = rappro.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={retour.href} className="link"><ArrowLeft size={13} /> {retour.label}</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Commande {c.code}</h1>
        <span className={`badge ${BADGE[c.status] ?? 'info'}`}>{STATUTS[c.status] ?? c.status}</span>
        <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700 }}>{euro(c.total_ht)}</span>
      </div>

      {auVisa && (
        <div className="card" style={{
          marginTop: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap', borderColor: 'var(--warning, #b45309)',
        }}>
          <ShieldCheck size={15} />
          <span style={{ fontSize: 13 }}>
            En attente de validation
            {(v?.manquants.length ?? 0) > 0 && <> — il manque <strong>{v!.manquants.map((m) => m.validateur).join(', ')}</strong></>}.
            La commande n’engage rien tant qu’elle n’est pas approuvée.
          </span>
          {v?.peutValider && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
              <input
                value={motif}
                placeholder="Motif (obligatoire pour refuser)"
                onChange={(e) => setMotif(e.target.value)}
                style={{ width: 230 }}
              />
              <button className="btn" disabled={approuver.isPending} onClick={() => approuver.mutate()}>
                Approuver
              </button>
              <button
                className="btn btn-secondary"
                disabled={motif.trim().length < 3 || refuser.isPending}
                onClick={() => refuser.mutate()}
              >
                Refuser
              </button>
            </div>
          )}
        </div>
      )}

      {c.status === 'validated' && (
        <div className="card" style={{
          marginTop: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap',
        }}>
          <Lock size={15} />
          <span style={{ fontSize: 13 }}>
            Commande envoyée : elle n’est plus modifiable. Un administrateur peut la rouvrir, avec
            un motif — l’opération reste au journal.
          </span>
          {!ouvrirReouverture && (
            <button
              className="btn btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setOuvrirReouverture(true)}
            >
              <Unlock size={13} /> Rouvrir
            </button>
          )}
          {ouvrirReouverture && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
              <input
                value={motif}
                placeholder="Motif de la réouverture"
                onChange={(e) => setMotif(e.target.value)}
                style={{ width: 260 }}
              />
              <button className="btn" disabled={motif.trim().length < 3 || rouvrir.isPending}
                onClick={() => { setErr(null); rouvrir.mutate(); }}>
                {rouvrir.isPending ? 'Réouverture…' : 'Confirmer'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setOuvrirReouverture(false); setErr(null); }}>
                Annuler
              </button>
            </div>
          )}
        </div>
      )}
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
        <div>
          <span className="muted">Chantier : </span>
          <span style={{
            display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 6,
            background: teinteChantier(c.chantier_id, c.chantier_couleur),
          }} />
          <Link href={`/chantiers/${c.chantier_id}`} className="link">
            {c.chantier_code} {c.chantier_nom}
          </Link>
        </div>
        <div><span className="muted">Fournisseur : </span>{c.fournisseur ?? '—'}</div>
        <div><span className="muted">Envoyée le : </span>{jour(c.validated_at)}</div>
      </div>

      {brouillon && (
        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <strong style={{ fontSize: 13 }}>Commande</strong>
          <p className="muted" style={{ margin: '2px 0 10px', fontSize: 11 }}>
            Ce que le fournisseur doit lire pour livrer : à qui, où, quand, à quelles conditions.
            Ces informations partiront sur le bon de commande.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Fournisseur</label>
              <select
                value={c.supplier_id ?? ''}
                onChange={(e) => majEntete.mutate({ supplierId: e.target.value || null })}
              >
                <option value="">— Choisir —</option>
                {(fournisseurs.data?.rows ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Contact</label>
              <input
                defaultValue={c.contact ?? ''}
                placeholder="Interlocuteur chez le fournisseur"
                onBlur={(e) => e.target.value !== (c.contact ?? '') && majEntete.mutate({ contact: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Livraison souhaitée le</label>
              <input
                type="date"
                defaultValue={c.delivery_date ?? ''}
                onBlur={(e) => e.target.value !== (c.delivery_date ?? '') && majEntete.mutate({ deliveryDate: e.target.value || null })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label>Adresse de livraison</label>
              <input
                defaultValue={c.delivery_address ?? ''}
                placeholder="Chantier, dépôt, autre adresse…"
                onBlur={(e) => e.target.value !== (c.delivery_address ?? '') && majEntete.mutate({ deliveryAddress: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Conditions de livraison</label>
              <input
                defaultValue={c.delivery_conditions ?? ''}
                placeholder="Franco, camion-grue, horaires…"
                onBlur={(e) => e.target.value !== (c.delivery_conditions ?? '') && majEntete.mutate({ deliveryConditions: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Conditions de règlement</label>
              <input
                defaultValue={c.payment_terms ?? ''}
                placeholder="30 jours fin de mois…"
                onBlur={(e) => e.target.value !== (c.payment_terms ?? '') && majEntete.mutate({ paymentTerms: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label>Observations</label>
              <input
                defaultValue={c.notes ?? ''}
                onBlur={(e) => e.target.value !== (c.notes ?? '') && majEntete.mutate({ notes: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}

      {!brouillon && (c.delivery_address || c.delivery_date || c.delivery_conditions) && (
        <div className="card" style={{ marginTop: 16, padding: '10px 14px', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
          {c.delivery_date && <div><span className="muted">Livraison souhaitée : </span>{jour(c.delivery_date)}</div>}
          {c.delivery_address && <div><span className="muted">Adresse : </span>{c.delivery_address}</div>}
          {c.delivery_conditions && <div><span className="muted">Conditions : </span>{c.delivery_conditions}</div>}
          {c.payment_terms && <div><span className="muted">Règlement : </span>{c.payment_terms}</div>}
        </div>
      )}

      {brouillon && (
        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Ajouter des lignes</strong>
            <button
              className="btn btn-secondary"
              title="Reprend ce qui a été BUDGÉTÉ sur ce chantier, avec son reste à commander"
              onClick={() => setApproOuvert(true)}
            >
              Approvisionner le chantier…
            </button>
            <button
              className="btn btn-secondary"
              title="Catalogue de l’entreprise — pour ce qui n’était pas prévu au budget"
              onClick={() => setCatalogueOuvert(true)}
            >
              Bibliothèque générale…
            </button>
            {info && <span style={{ fontSize: 12, color: 'var(--success, #15803d)' }}>{info}</span>}
            {(v?.requis.length ?? 0) > 0 && (
              <span className="muted" style={{ fontSize: 11 }}>
                Visa requis : {v!.requis.map((r) => r.validateur).join(', ')}
              </span>
            )}
            <button
              className="btn"
              style={{ marginLeft: 'auto' }}
              disabled={f.lignes.length === 0 || envoyer.isPending}
              title={f.lignes.length === 0
                ? 'Une commande vide ne s’envoie pas'
                : (v?.requis.length ?? 0) > 0
                  ? 'Elle passera par ses validateurs avant de partir'
                  : 'Envoyer au fournisseur'}
              onClick={() => envoyer.mutate()}
            >
              {envoyer.isPending ? 'Envoi…' : 'Envoyer la commande'}
            </button>
            <button className="btn btn-secondary" disabled={annuler.isPending} onClick={() => annuler.mutate()}>
              Annuler le BC
            </button>
          </div>

        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th style={{ width: 120 }}>Code</th>
              <th>Désignation</th>
              <th style={{ width: 80 }}>Unité</th>
              <th style={{ width: 90, textAlign: 'right' }}>Qté</th>
              <th style={{ width: 110, textAlign: 'right' }}>PU</th>
              <th style={{ width: 130, textAlign: 'right' }}>Total HT</th>
              <th style={{ width: 190 }}>Code analytique *</th>
              {brouillon && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {f.lignes.map((l) => (
              brouillon ? (
                // Édition EN PLACE, comme le montage d'un devis : on corrige la cellule qu'on
                // regarde, sans rouvrir un formulaire au-dessus du tableau.
                <Fragment key={l.id}>
                {l.kind === 'comment' ? (
                  // Un commentaire occupe toute la largeur : ni quantité, ni prix, ni imputation.
                  <tr>
                    <td style={{ textAlign: 'center', padding: 0 }}>
                      <span className="muted" style={{ fontSize: 11 }}>✎</span>
                    </td>
                    <td colSpan={7}>
                      <input
                        defaultValue={l.designation}
                        placeholder="Commentaire à l’attention du fournisseur"
                        onBlur={(e) => e.target.value !== l.designation
                          && majLigne.mutate({ id: l.id, patch: { designation: e.target.value } })}
                        style={{ width: '100%', fontStyle: 'italic' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 6 }}>
                      <IconBtn
                        title="Retirer ce commentaire"
                        color="var(--danger, #dc2626)"
                        onClick={() => supprimerLigne.mutate(l.id)}
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </td>
                  </tr>
                ) : (
                <tr>
                  <td style={{ textAlign: 'center', padding: 0 }}>
                    <BoutonInfo
                      ouvert={ligneOuverte === l.id}
                      onClick={() => setLigneOuverte(ligneOuverte === l.id ? null : l.id)}
                    />
                  </td>
                  <td>
                    {/* Le code se tape : s'il existe au catalogue, la ligne se remplit seule. */}
                    <input
                      defaultValue={l.code ?? ''}
                      placeholder="Code"
                      title="Saisissez un code du catalogue : la ligne se remplit avec l’article"
                      onBlur={(e) => e.target.value !== (l.code ?? '')
                        && majLigne.mutate({ id: l.id, patch: { code: e.target.value } })}
                      style={{ width: '100%', fontFamily: 'var(--mono, ui-monospace)', fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={l.designation}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== l.designation
                        && majLigne.mutate({ id: l.id, patch: { designation: e.target.value } })}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <select
                      defaultValue={l.unite_achat ?? ''}
                      onChange={(e) => majLigne.mutate({ id: l.id, patch: { uniteAchat: e.target.value || null } })}
                      style={{ width: '100%', fontSize: 12 }}
                    >
                      <option value="">—</option>
                      {(unites.data ?? []).map((u) => (
                        <option key={u.id} value={u.abrev} title={u.label}>{u.abrev}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number" min={0} step="0.01" defaultValue={Number(l.quantity)}
                      onBlur={(e) => Number(e.target.value) !== Number(l.quantity)
                        && majLigne.mutate({ id: l.id, patch: { quantity: e.target.value } })}
                      style={{ width: '100%', textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number" min={0} step="0.01" defaultValue={Number(l.unit_price)}
                      onBlur={(e) => Number(e.target.value) !== Number(l.unit_price)
                        && majLigne.mutate({ id: l.id, patch: { unitPrice: e.target.value } })}
                      style={{ width: '100%', textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {euro(l.amount_ht)}
                  </td>
                  <td>
                    <SelectCodeAnalytique
                      valeur={l.code_analytique_id}
                      codes={codes}
                      obligatoire
                      onChange={(id) => majLigne.mutate({ id: l.id, patch: { codeAnalytiqueId: id } })}
                    />
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 6, whiteSpace: 'nowrap' }}>
                    <IconBtn
                      title="Ajouter un commentaire sous cette ligne"
                      color="var(--muted)"
                      onClick={() => ajouterCommentaire.mutate({ sortOrder: l.sort_order })}
                    >
                      <MessageSquarePlus size={13} />
                    </IconBtn>
                    <IconBtn
                      title="Retirer cette ligne"
                      color="var(--danger, #dc2626)"
                      onClick={() => supprimerLigne.mutate(l.id)}
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                  </td>
                </tr>
                )}
                {ligneOuverte === l.id && (
                  <tr>
                    <td colSpan={9} style={{ background: 'var(--surface)', padding: '10px 14px' }}>
                      <InfosLigne
                        ligne={l}
                        ouvrages={ouvrages}
                        onChange={(patch) => majLigne.mutate({ id: l.id, patch })}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ) : (
                <Fragment key={l.id}>
                <tr>
                  <td style={{ textAlign: 'center', padding: 0 }}>
                    <BoutonInfo
                      ouvert={ligneOuverte === l.id}
                      onClick={() => setLigneOuverte(ligneOuverte === l.id ? null : l.id)}
                    />
                  </td>
                  <td className="code-cell">
                    {l.code ?? l.ressource_code ?? <span className="muted">—</span>}
                  </td>
                  <td style={l.kind === 'comment' ? { fontStyle: 'italic', color: 'var(--muted)' } : undefined}>
                    {l.designation}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {l.kind === 'comment' ? '' : (l.unite_achat ?? l.unite_emploi ?? '—')}
                  </td>
                  <td style={{ textAlign: 'right' }}>{Number(l.quantity)}</td>
                  <td style={{ textAlign: 'right' }}>{euro(l.unit_price)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {euro(l.amount_ht)}
                  </td>
                  <td>
                    {l.kind === 'comment' ? '' : (
                      <SelectCodeAnalytique valeur={l.code_analytique_id} codes={codes} lecture />
                    )}
                  </td>
                </tr>
                {ligneOuverte === l.id && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--surface)', padding: '10px 14px' }}>
                      <InfosLigne ligne={l} ouvrages={ouvrages} />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            ))}
            {f.lignes.length === 0 && (
              <tr><td colSpan={brouillon ? 9 : 8} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Cette commande n’a aucune ligne.
              </td></tr>
            )}
            {brouillon && (
              <tr>
                <td colSpan={9} style={{ padding: '8px 10px' }}>
                  <MenuAjout
                    onRessource={() => setApproOuvert(true)}
                    onCatalogue={() => setCatalogueOuvert(true)}
                    onLigneLibre={() => ajouterLigne.mutate()}
                    onCommentaire={() => ajouterCommentaire.mutate(undefined)}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!brouillon && r && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', flexWrap: 'wrap',
            borderBottom: '1px solid var(--border)',
          }}>
            <strong style={{ fontSize: 13 }}>Suivi des livraisons et factures</strong>
            <span className={`badge ${ETAT_BADGE[r.receptionEtat]}`}>
              Réception : {ETATS[r.receptionEtat]}
            </span>
            <span className={`badge ${ETAT_BADGE[r.factureEtat]}`}>
              Facturation : {ETATS[r.factureEtat]}
            </span>
            {r.soldee && <span className="badge success">Commande soldée</span>}
            {Number(r.ecartPrixTotal) !== 0 && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: Number(r.ecartPrixTotal) > 0 ? 'var(--danger, #dc2626)' : 'var(--success, #15803d)',
              }}>
                Écart de prix : {euro(r.ecartPrixTotal)}
              </span>
            )}
            {envoyee && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  disabled={r.receptionEtat === 'complete'}
                  title={r.receptionEtat === 'complete' ? 'Tout est arrivé' : undefined}
                  onClick={() => setSaisie('reception')}
                >
                  <PackageCheck size={13} /> Réceptionner
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={r.factureEtat === 'complete'}
                  title={r.factureEtat === 'complete' ? 'Tout est facturé' : undefined}
                  onClick={() => setSaisie('facture')}
                >
                  <ReceiptText size={13} /> Facturer
                </button>
              </span>
            )}
          </div>

          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Désignation</th>
                <th style={{ textAlign: 'right', width: 100 }}>Commandé</th>
                <th style={{ textAlign: 'right', width: 90 }}>Reçu</th>
                <th style={{ textAlign: 'right', width: 100 }}>Reste à recevoir</th>
                <th style={{ textAlign: 'right', width: 90 }}>Facturé</th>
                <th style={{ textAlign: 'right', width: 100 }}>PU commandé</th>
                <th style={{ textAlign: 'right', width: 100 }}>PU facturé</th>
                <th style={{ textAlign: 'right', width: 100 }}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {r.lignes.map((l) => {
                const ecart = Number(l.ecartPrix);
                const reste = Number(l.resteARecevoir);
                return (
                  <tr key={l.orderLineId}>
                    <td>
                      {l.designation}
                      {l.ouvrage && <span className="muted" style={{ fontSize: 11 }}> · {l.ouvrage}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(l.quantiteCommandee)} {l.uniteAchat ?? ''}
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantiteRecue)}</td>
                    <td style={{
                      textAlign: 'right', fontWeight: reste > 0 ? 600 : 400,
                      color: reste > 0 ? 'var(--accent)' : 'var(--muted)',
                    }}>
                      {reste > 0 ? Number(l.resteARecevoir) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantiteFacturee)}</td>
                    <td style={{ textAlign: 'right' }}>{euro(l.puCommande)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.puFacture ? euro(l.puFacture) : <span className="muted">—</span>}
                    </td>
                    <td style={{
                      textAlign: 'right', fontWeight: 600,
                      color: ecart > 0 ? 'var(--danger, #dc2626)' : ecart < 0 ? 'var(--success, #15803d)' : undefined,
                    }}>
                      {ecart === 0 ? '—' : euro(l.ecartPrix)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(f.receptions.length > 0 || f.factures.length > 0) && (
            <div style={{
              display: 'flex', gap: 24, flexWrap: 'wrap', padding: '10px 14px',
              borderTop: '1px solid var(--border)', fontSize: 12,
            }}>
              {f.receptions.length > 0 && (
                <div>
                  <span className="muted">Bons de livraison : </span>
                  {f.receptions.map((d) => `${d.code} (${jour(d.received_at)})`).join(' · ')}
                </div>
              )}
              {f.factures.length > 0 && (
                <div>
                  <span className="muted">Factures : </span>
                  {f.factures.map((x) => `${x.code} — ${euro(x.amount_ht)}`).join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(journal.data ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <History size={15} /><strong style={{ fontSize: 13 }}>Journal</strong>
            {c.reopened_count > 0 && (
              <span className="muted" style={{ fontSize: 11 }}>
                · rouverte {c.reopened_count} fois
              </span>
            )}
          </div>
          {(journal.data ?? []).map((e) => (
            <div key={e.id} style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 10 }}>
              <span className="muted" style={{ minWidth: 130 }}>
                {new Date(e.created_at).toLocaleString('fr-FR')}
              </span>
              <strong style={{ minWidth: 190 }}>{ACTIONS[e.action] ?? e.action}</strong>
              <span className="muted">{e.auteur || e.auteur_email || '—'}</span>
              {e.motif && <span>· {e.motif}</span>}
            </div>
          ))}
        </div>
      )}

      {saisie && r && (
        <SaisieRapprochement
          mode={saisie}
          orderId={orderId}
          lignes={r.lignes}
          onClose={() => setSaisie(null)}
          onEnregistre={(message) => { setSaisie(null); setInfo(message); rafraichir(); }}
        />
      )}

      {catalogueOuvert && (
        <BibliothequeCommandeModal
          orderId={orderId}
          onClose={() => setCatalogueOuvert(false)}
          onInsere={(n) => {
            setCatalogueOuvert(false);
            setInfo(`${n} article${n > 1 ? 's' : ''} inséré${n > 1 ? 's' : ''} depuis la bibliothèque.`);
            rafraichir();
          }}
        />
      )}

      {approOuvert && (
        <ApproModal
          chantierId={c.chantier_id}
          orderId={orderId}
          onClose={() => setApproOuvert(false)}
          onInsere={(n) => {
            setApproOuvert(false);
            setInfo(n > 0
              ? `${n} ligne${n > 1 ? 's' : ''} insérée${n > 1 ? 's' : ''}.`
              : 'Rien à insérer : le besoin est déjà couvert.');
            rafraichir();
          }}
        />
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        La validation par seuil, l’aperçu PDF et le rapprochement ligne à ligne arrivent aux étapes
        suivantes.
      </p>
    </div>
  );
}
