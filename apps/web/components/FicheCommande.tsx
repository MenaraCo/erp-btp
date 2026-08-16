'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, History, Lock, PackageCheck, ReceiptText, Redo2, Send, ShieldCheck,
  Undo2, Unlock, X,
} from 'lucide-react';
import { apiFetch, apiDownload, apiFetchBlobUrl, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { teinteChantier } from '@/components/CalendrierMois';
import { ApproModal } from '@/components/ApproModal';
import { LigneRapprochement, SaisieRapprochement } from '@/components/SaisieRapprochement';
import { BibliothequeCommandeModal } from '@/components/BibliothequeCommandeModal';
import { CodeAnalytique, SelectCodeAnalytique } from '@/components/SelectCodeAnalytique';
import { SelectRessource } from '@/components/SelectRessource';
import { Modale } from '@/components/Modale';
import { EnvoiCommandeModal } from '@/components/EnvoiCommandeModal';
import { CELL_CTR, Cellule, UnitSelect, infoBtn } from '@/components/GrilleSaisie';

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
    fournisseur_email: string | null; sent_at: string | null; sent_to: string | null;
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
  validated: 'Validée', cancelled: 'Annulée', reopened: 'Rouverte',
  received: 'Réception enregistrée', invoiced: 'Facture enregistrée',
  emailed: 'Expédiée par e-mail', email_pending: 'E-mail en attente d’expédition',
};

interface EtatValidation {
  requis: Array<{ validatorId: string; validateur: string; montantMin: string }>;
  manquants: Array<{ validatorId: string; validateur: string; montantMin: string }>;
  peutValider: boolean;
}
/**
 * Colonnes de la commande, dans le même esprit que le déboursé : marqueur, code, désignation
 * élastique, puis les chiffres calés à droite. Les actions sont un bandeau flottant révélé au
 * survol — au repos, toute la largeur va aux colonnes utiles.
 */
const GRILLE_COMMANDE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 96px minmax(160px,1fr) 62px 70px 78px 92px 58px',
  alignItems: 'stretch',
  columnGap: 0,
};
const GRILLE_COMMENTAIRE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 1fr',
  alignItems: 'stretch',
  columnGap: 0,
};

/** Valeur actuelle d'un champ de ligne, exprimée comme le patch l'attend. */
function valeurCourante(ligne: Ligne, cle: string): string | null {
  switch (cle) {
    case 'designation': return ligne.designation;
    case 'quantity': return String(Number(ligne.quantity));
    case 'unitPrice': return String(Number(ligne.unit_price));
    case 'nature': return ligne.nature;
    case 'code': return ligne.code;
    case 'uniteAchat': return ligne.unite_achat;
    case 'codeAnalytiqueId': return ligne.code_analytique_id;
    case 'executionLineId': return ligne.execution_line_id;
    case 'refFournisseur': return ligne.ref_fournisseur;
    case 'codeProduit': return ligne.code_produit;
    case 'coeffConversion': return ligne.coeff_conversion;
    default: return null;
  }
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
 * Volet technique d'une ligne : référence fournisseur, code produit, conditionnement.
 *
 * Éditable en brouillon — y compris sur une ligne venue d'un catalogue : la commande est une
 * COPIE, et le fournisseur peut avoir changé de référence sans que le catalogue le sache encore.
 */
function FicheRessourceModal({
  ligne,
  ouvrages,
  lecture,
  onChange,
  onClose,
}: {
  ligne: Ligne;
  ouvrages: Array<{ id: string; label: string }>;
  lecture: boolean;
  onChange: (patch: Record<string, string | null>) => void;
  onClose: () => void;
}) {
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
            onBlur={(e) => e.target.value !== (valeur ?? '') && onChange({ [cle]: e.target.value || null })}
          />
        )}
    </div>
  );

  const coeff = Number(ligne.coeff_conversion || 0);
  return (
    <Modale
      titre="Fiche ressource"
      sousTitre={`${ligne.code ? `${ligne.code} · ` : ''}${ligne.designation}`}
      largeur="l"
      onClose={onClose}
      actions={<button className="btn" onClick={onClose}>Fermer</button>}
    >
      <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Nature</label>
          {lecture
            ? <div style={{ fontSize: 13, padding: '4px 0' }}>{NATURES[ligne.nature] ?? ligne.nature}</div>
            : (
              <select
                defaultValue={ligne.nature}
                onChange={(e) => onChange({ nature: e.target.value })}
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
                onChange={(e) => onChange({ executionLineId: e.target.value || null })}
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

      </>
    </Modale>
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
  const [apercu, setApercu] = useState(false);
  const [envoiOuvert, setEnvoiOuvert] = useState(false);
  /**
   * Annuler / rétablir : chaque modification de ligne pousse le couple (avant, après). Annuler
   * réapplique l'état d'avant, rétablir celui d'après — par le même chemin que la saisie, donc
   * avec les mêmes contrôles. Une erreur de frappe ne coûte plus une re-saisie.
   */
  const [historique, setHistorique] = useState<Array<{
    id: string; avant: Record<string, unknown>; apres: Record<string, unknown>;
  }>>([]);
  const [rang, setRang] = useState(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
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
    mutationFn: (v: {
      id: string;
      patch: Record<string, string | null>;
      /** Rejeu d'un annuler/rétablir : on ne réempile pas ce qu'on est en train de dépiler. */
      sansHistorique?: boolean;
    }) => {
      const ligne = fiche.data?.lignes.find((l) => l.id === v.id);
      const avant = ligne
        ? Object.fromEntries(Object.keys(v.patch).map((cle) => [cle, valeurCourante(ligne, cle)]))
        : {};
      return apiFetch(`/purchase-order-lines/${v.id}`, { method: 'PATCH', token, body: v.patch })
        .then((r) => ({ r, id: v.id, avant, apres: v.patch, sansHistorique: v.sansHistorique }));
    },
    onSuccess: (v) => {
      if (!v.sansHistorique) {
        // Une nouvelle action efface ce qui avait été « rétabli » : on ne garde pas deux futurs.
        setHistorique((h) => [...h.slice(0, rang), { id: v.id, avant: v.avant, apres: v.apres }]);
        setRang((n) => n + 1);
      }
      rafraichir();
    },
    onError: (e) => echec(e, 'Ligne non modifiée.'),
  });

  const revenirEnArriere = () => {
    const pas = historique[rang - 1];
    if (!pas) return;
    setRang((n) => n - 1);
    majLigne.mutate({ id: pas.id, patch: pas.avant as Record<string, string | null>, sansHistorique: true });
  };
  const retablir = () => {
    const pas = historique[rang];
    if (!pas) return;
    setRang((n) => n + 1);
    majLigne.mutate({ id: pas.id, patch: pas.apres as Record<string, string | null>, sansHistorique: true });
  };
  const supprimerLigne = useMutation({
    mutationFn: (id: string) => apiFetch(`/purchase-order-lines/${id}`, { method: 'DELETE', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Ligne non supprimée.'),
  });

  /**
   * Aperçu : le PDF est protégé par le jeton, qu'une iframe ne sait pas porter. On le récupère
   * donc en mémoire (blob) puis on l'affiche — et on le régénère à chaque changement de la
   * commande, pour que l'aperçu ne mente jamais sur ce qui partira.
   */
  const signature = `${fiche.data?.commande.total_ht}-${fiche.data?.lignes.length}-${fiche.data?.commande.status}`;
  useEffect(() => {
    if (!apercu || !token) { setPdfUrl(null); return undefined; }
    let annule = false;
    let ancienne: string | null = null;
    apiFetchBlobUrl(`/purchase-orders/${orderId}/bon-de-commande.pdf`, token)
      .then((url) => {
        if (annule) { URL.revokeObjectURL(url); return; }
        ancienne = url;
        setPdfUrl(url);
      })
      .catch(() => setErr('Aperçu indisponible.'));
    return () => {
      annule = true;
      if (ancienne) URL.revokeObjectURL(ancienne);
    };
  }, [apercu, token, orderId, signature]);

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
    <div style={apercu ? { display: 'flex', gap: 16, alignItems: 'flex-start' } : undefined}>
      <div style={apercu ? { flex: '1 1 0', minWidth: 0 } : undefined}>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={retour.href} className="link"><ArrowLeft size={13} /> {retour.label}</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Commande {c.code}</h1>
        <span className={`badge ${BADGE[c.status] ?? 'info'}`}>{STATUTS[c.status] ?? c.status}</span>

        {brouillon && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
            <button
              className="btn btn-ghost"
              title="Annuler la dernière modification"
              disabled={rang === 0}
              onClick={revenirEnArriere}
            >
              <Undo2 size={14} />
            </button>
            <button
              className="btn btn-ghost"
              title="Rétablir"
              disabled={rang >= historique.length}
              onClick={retablir}
            >
              <Redo2 size={14} />
            </button>
          </span>
        )}

        {/* Le document se relit et se télécharge à TOUT moment : brouillon, envoyée ou soldée. */}
        <button
          className="btn btn-secondary"
          style={{ marginLeft: 'auto' }}
          title="Relire le bon de commande tel qu'il part au fournisseur"
          onClick={() => setApercu((a) => !a)}
        >
          <FileText size={13} /> {apercu ? 'Masquer l’aperçu' : 'Aperçu PDF'}
        </button>
        <button
          className="btn btn-secondary"
          title="Télécharger le bon de commande"
          onClick={() => apiDownload(
            `/purchase-orders/${orderId}/bon-de-commande.pdf`, token, `${c.code}.pdf`,
          )}
        >
          Télécharger
        </button>

        <span style={{ fontSize: 20, fontWeight: 700 }}>{euro(c.total_ht)}</span>
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

      {envoyee && (
        <div className="card" style={{
          marginTop: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap',
        }}>
          <Send size={15} />
          {c.sent_at ? (
            <span style={{ fontSize: 13 }}>
              Envoyée au fournisseur le <strong>{jour(c.sent_at)}</strong>
              {c.sent_to && <> à <strong>{c.sent_to}</strong></>}.
            </span>
          ) : (
            <span style={{ fontSize: 13 }}>
              Le bon de commande n’a pas encore été expédié. Envoyez-le d’ici : le PDF est joint
              tout seul, sans rien enregistrer ni rouvrir votre messagerie.
            </span>
          )}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEnvoiOuvert(true)}>
            <Send size={13} /> {c.sent_at ? 'Renvoyer' : 'Envoyer au fournisseur'}
          </button>
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

      {/*
        Grille de saisie : EXACTEMENT celle du déboursé d'une étude de prix — mêmes classes
        (.deb-table / .sd-head / .sd-row), mêmes cellules sans habillage, même Entrée qui descend
        d'une ligne. Passer d'un module à l'autre ne doit pas demander de réapprendre un geste.
      */}
      <div className="card deb-table" style={{ marginTop: 16, padding: 0, overflow: 'visible' }}>
        <div className="sd-head" style={{
          ...GRILLE_COMMANDE, padding: '3px 6px', fontSize: 9, textTransform: 'uppercase',
          letterSpacing: '0.3px', fontWeight: 700, background: '#eef2f7',
          borderBottom: '1px solid #dbe2ea',
        }}>
          <span />
          <span style={{ paddingLeft: 4 }}>Code</span>
          <span style={{ paddingLeft: 4 }}>Désignation</span>
          <span style={{ justifyContent: 'center' }}>Unité</span>
          <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Qté</span>
          <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>P.U.</span>
          <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Montant</span>
          <span style={{ justifyContent: 'center' }} title="Code analytique — obligatoire">Analy.</span>
          <span />
        </div>

        {f.lignes.map((l) => (
          l.kind === 'comment' ? (
            // Un commentaire traverse la grille : ni quantité, ni prix, ni imputation.
            <div key={l.id} className="sd-row" style={{ ...GRILLE_COMMENTAIRE, padding: '0 6px', fontSize: 12 }}>
              <span style={CELL_CTR} title="Commentaire">✎</span>
              <Cellule
                cell="commande:commentaire"
                valeur={l.designation}
                readOnly={!brouillon}
                placeholder="Commentaire à l’attention du fournisseur"
                style={{ fontStyle: 'italic' }}
                onChange={(v) => majLigne.mutate({ id: l.id, patch: { designation: v } })}
              />
              <span className="sd-actions">
                {brouillon && (
                  <button className="btn-ghost" title="Supprimer" onClick={() => supprimerLigne.mutate(l.id)}>✕</button>
                )}
              </span>
            </div>
          ) : (
            <div key={l.id} className="sd-row" style={{ ...GRILLE_COMMANDE, padding: '0 6px', fontSize: 12, color: '#475569' }}>
              <span style={CELL_CTR}>
                <button
                  type="button"
                  className="btn-ghost"
                  title="Fiche ressource (nature, ouvrage, conditionnement)"
                  onClick={() => setLigneOuverte(l.id)}
                  style={infoBtn}
                >
                  ⓘ
                </button>
              </span>
              <SelectRessource
                valeur={l.code}
                chantierId={c.chantier_id}
                readOnly={!brouillon}
                onChange={(v) => majLigne.mutate({ id: l.id, patch: { code: v } })}
              />
              <Cellule
                cell="commande:designation"
                valeur={l.designation}
                readOnly={!brouillon}
                title={l.designation}
                style={{ minWidth: 0 }}
                onChange={(v) => v.trim() && majLigne.mutate({ id: l.id, patch: { designation: v } })}
              />
              <UnitSelect
                value={l.unite_achat}
                token={token}
                readOnly={!brouillon}
                style={{ width: '100%' }}
                onChange={(v) => majLigne.mutate({ id: l.id, patch: { uniteAchat: v || null } })}
              />
              <Cellule
                cell="commande:quantite"
                type="number"
                align="right"
                valeur={Number(l.quantity)}
                readOnly={!brouillon}
                title="Quantité"
                onChange={(v) => majLigne.mutate({ id: l.id, patch: { quantity: v || '0' } })}
              />
              <Cellule
                cell="commande:pu"
                type="number"
                align="right"
                valeur={Number(l.unit_price)}
                readOnly={!brouillon}
                title="Prix unitaire d’achat"
                onChange={(v) => majLigne.mutate({ id: l.id, patch: { unitPrice: v || '0' } })}
              />
              <span style={{
                width: '100%', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums',
                color: '#334155', fontWeight: 500, paddingRight: 4,
              }}>
                {euro(l.amount_ht)}
              </span>
              <SelectCodeAnalytique
                valeur={l.code_analytique_id}
                codes={codes}
                obligatoire
                lecture={!brouillon}
                onChange={(id) => majLigne.mutate({ id: l.id, patch: { codeAnalytiqueId: id } })}
              />
              <span className="sd-actions">
                {brouillon && (
                  <>
                    <button
                      className="btn-ghost"
                      title="Ajouter un commentaire sous cette ligne"
                      onClick={() => ajouterCommentaire.mutate({ sortOrder: l.sort_order })}
                    >
                      ✎
                    </button>
                    <button className="btn-ghost" title="Supprimer" onClick={() => supprimerLigne.mutate(l.id)}>✕</button>
                  </>
                )}
              </span>
            </div>
          )
        ))}

        {f.lignes.length === 0 && (
          <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
            Cette commande n’a aucune ligne.
          </div>
        )}

        {brouillon && (
          <div style={{ padding: '8px 10px' }}>
            <MenuAjout
              onRessource={() => setApproOuvert(true)}
              onCatalogue={() => setCatalogueOuvert(true)}
              onLigneLibre={() => ajouterLigne.mutate()}
              onCommentaire={() => ajouterCommentaire.mutate(undefined)}
            />
          </div>
        )}
      </div>

      {ligneOuverte && (() => {
        const ligne = f.lignes.find((x) => x.id === ligneOuverte);
        return ligne ? (
          <FicheRessourceModal
            ligne={ligne}
            ouvrages={ouvrages}
            lecture={!brouillon}
            onChange={(patch) => majLigne.mutate({ id: ligne.id, patch })}
            onClose={() => setLigneOuverte(null)}
          />
        ) : null;
      })()}

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

      {envoiOuvert && (
        <EnvoiCommandeModal
          orderId={orderId}
          code={c.code}
          chantier={c.chantier_code}
          emailFournisseur={c.fournisseur_email}
          onClose={() => setEnvoiOuvert(false)}
          onEnvoye={(message) => { setEnvoiOuvert(false); setInfo(message); rafraichir(); }}
        />
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
        L’import des bons de livraison et des factures (avec lecture automatique) arrive à l’étape
        suivante.
      </p>
      </div>

      {/*
        Aperçu en VUE PARTAGÉE : le document à droite, la commande à gauche. On relit ce qui va
        partir sans perdre de vue ce qu'on corrige — un aperçu en plein écran obligerait à faire
        des allers-retours pour chaque coquille.
      */}
      {apercu && (
        <aside style={{
          flex: '0 0 clamp(360px, 42%, 620px)', position: 'sticky', top: 12,
          height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
        }}>
          <div className="card" style={{
            padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
          }}>
            <FileText size={14} />
            <strong style={{ fontSize: 13 }}>Bon de commande {c.code}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              tel qu’il partira au fournisseur
            </span>
            {/* Soupape : certains navigateurs refusent d'afficher un PDF dans la page. */}
            {pdfUrl && (
              <a
                className="btn btn-ghost"
                style={{ marginLeft: 'auto' }}
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir dans un onglet"
              >
                Ouvrir
              </a>
            )}
            <button
              className="btn btn-secondary"
              style={pdfUrl ? undefined : { marginLeft: 'auto' }}
              title="Télécharger le bon de commande"
              onClick={() => apiDownload(
                `/purchase-orders/${orderId}/bon-de-commande.pdf`, token, `${c.code}.pdf`,
              )}
            >
              Télécharger
            </button>
            <button className="btn btn-ghost" title="Fermer l’aperçu" onClick={() => setApercu(false)}>
              <X size={14} />
            </button>
          </div>
          {pdfUrl ? (
            /*
              `object` plutôt qu'`iframe` : quand le navigateur refuse d'afficher un PDF dans la
              page (réglage « télécharger les PDF » ou lecteur désactivé), il affiche le contenu
              de repli au lieu d'un rectangle vide — l'utilisateur comprend ce qui se passe et
              garde une porte de sortie.
            */
            /*
              Fond OPAQUE porté par un conteneur : sous un thème translucide (Liquid Glass), un
              lecteur PDF qui ne peint pas laisse voir le fond sombre de la page — d'où l'écran
              noir. Le blanc doit venir d'un élément plein, pas de l'objet lui-même.
            */
            <div style={{
              flex: 1, minHeight: 0, background: '#fff', border: '1px solid var(--border)',
              borderRadius: 8, overflow: 'hidden',
            }}>
            <object
              data={pdfUrl}
              type="application/pdf"
              aria-label={`Aperçu du bon de commande ${c.code}`}
              style={{ width: '100%', height: '100%', background: '#fff' }}
            >
              <div className="card" style={{
                height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24,
              }}>
                <FileText size={22} />
                <p className="muted" style={{ margin: 0, fontSize: 12, maxWidth: 280 }}>
                  Votre navigateur n’affiche pas les PDF dans la page. Le document est prêt :
                  ouvrez-le dans un onglet ou téléchargez-le.
                </p>
                <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
              </div>
            </object>
            </div>
          ) : (
            <div className="card muted" style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
            }}>
              Préparation de l’aperçu…
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
