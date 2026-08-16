'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, Lock, PackageCheck, ReceiptText, Unlock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { teinteChantier } from '@/components/CalendrierMois';
import { ApproModal } from '@/components/ApproModal';

interface Ligne {
  id: string;
  nature: string;
  designation: string;
  quantity: string;
  unit_price: string;
  amount_ht: string;
  ouvrage: string | null;
  code_analytique: string | null;
  ressource_code: string | null;
  unite_achat: string | null;
}
interface Evenement {
  id: string; action: string; motif: string | null; created_at: string;
  auteur: string | null; auteur_email: string | null;
}
interface Fiche {
  commande: {
    id: string; code: string; status: string; total_ht: string; validated_at: string | null;
    created_at: string; chantier_id: string; chantier_code: string | null; chantier_nom: string | null;
    chantier_couleur: string | null; fournisseur: string | null; reopened_count: number;
  };
  lignes: Ligne[];
  receptions: Array<{ id: string; code: string; received_at: string | null }>;
  factures: Array<{ id: string; code: string; nature: string; amount_ht: string; invoice_date: string | null }>;
}

const NATURES: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: 'Main d’œuvre', site_overhead: 'Frais de chantier',
};
const STATUTS: Record<string, string> = { draft: 'Brouillon', validated: 'Envoyée', cancelled: 'Annulée' };
const BADGE: Record<string, string> = { draft: 'info', validated: 'success', cancelled: 'danger' };
const ACTIONS: Record<string, string> = {
  validated: 'Envoyée au fournisseur', cancelled: 'Annulée', reopened: 'Rouverte',
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
  const [nature, setNature] = useState('material');
  const [designation, setDesignation] = useState('');
  const [quantite, setQuantite] = useState('');
  const [pu, setPu] = useState('');
  const [ouvrage, setOuvrage] = useState('');
  const [codeAnalytique, setCodeAnalytique] = useState('');
  const [approOuvert, setApproOuvert] = useState(false);
  const [factureCode, setFactureCode] = useState('');
  const [factureMontant, setFactureMontant] = useState('');
  const [factureNature, setFactureNature] = useState('material');
  const [info, setInfo] = useState<string | null>(null);
  const [ouvrirReouverture, setOuvrirReouverture] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fiche = useQuery({
    queryKey: ['commande', orderId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Fiche>(`/purchase-orders/${orderId}`, { token }),
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
  const codes = (plan.data ?? []).flatMap((n) =>
    n.lots.flatMap((l) => l.familles.flatMap((fa) =>
      fa.codes.map((c) => ({ id: c.id, label: `${c.code} — ${c.label}` })))));

  const rafraichir = () => {
    setErr(null);
    for (const key of ['commande', 'commande-journal', 'achats-commandes', 'purchasing-chain', 'purchasing-summary', 'execution-tree']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const echec = (e: unknown, defaut: string) =>
    setErr(e instanceof ApiError ? e.message : defaut);

  const ajouterLigne = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/lines`, {
      method: 'POST', token,
      body: {
        nature, designation, quantity: quantite, unitPrice: pu,
        executionLineId: ouvrage || null, codeAnalytiqueId: codeAnalytique || null,
      },
    }),
    onSuccess: () => {
      setDesignation(''); setQuantite(''); setPu(''); setOuvrage(''); setCodeAnalytique('');
      rafraichir();
    },
    onError: (e) => echec(e, 'Ligne non ajoutée.'),
  });
  const valider = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/validate`, { method: 'POST', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Validation impossible.'),
  });
  const annuler = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/cancel`, { method: 'POST', token }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Annulation impossible.'),
  });
  const receptionner = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/delivery-notes`, { method: 'POST', token, body: {} }),
    onSuccess: rafraichir,
    onError: (e) => echec(e, 'Réception impossible.'),
  });
  const enregistrerFacture = useMutation({
    mutationFn: () => apiFetch(`/purchase-orders/${orderId}/invoices`, {
      method: 'POST', token,
      body: { code: factureCode, nature: factureNature, amountHt: factureMontant },
    }),
    onSuccess: () => { setFactureCode(''); setFactureMontant(''); rafraichir(); },
    onError: (e) => echec(e, 'Facture non enregistrée.'),
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
  const factureTotal = f.factures.reduce((t, x) => t + Number(x.amount_ht), 0);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Ajouter des lignes</strong>
            <button className="btn btn-secondary" onClick={() => setApproOuvert(true)}>
              Depuis la bibliothèque chantier…
            </button>
            {info && <span style={{ fontSize: 12, color: 'var(--success, #15803d)' }}>{info}</span>}
            <button
              className="btn"
              style={{ marginLeft: 'auto' }}
              disabled={f.lignes.length === 0 || valider.isPending}
              title={f.lignes.length === 0 ? 'Une commande vide ne s’envoie pas' : 'Envoyer au fournisseur'}
              onClick={() => valider.mutate()}
            >
              {valider.isPending ? 'Envoi…' : 'Envoyer la commande'}
            </button>
            <button className="btn btn-secondary" disabled={annuler.isPending} onClick={() => annuler.mutate()}>
              Annuler le BC
            </button>
          </div>

          <form
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!designation.trim() || !quantite || !pu) return;
              ajouterLigne.mutate();
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Nature</label>
              <select value={nature} onChange={(e) => setNature(e.target.value)} style={{ width: 150 }}>
                {NATURES_SAISIE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Désignation</label>
              <input value={designation} onChange={(e) => setDesignation(e.target.value)} style={{ width: 220 }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Qté</label>
              <input type="number" min={0} step="0.01" value={quantite}
                onChange={(e) => setQuantite(e.target.value)} style={{ width: 80, textAlign: 'right' }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>PU (€)</label>
              <input type="number" min={0} step="0.01" value={pu}
                onChange={(e) => setPu(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Ouvrage</label>
              <select value={ouvrage} onChange={(e) => setOuvrage(e.target.value)} style={{ width: 200 }}>
                <option value="">— Non réparti —</option>
                {ouvrages.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Code analytique</label>
              <select value={codeAnalytique} onChange={(e) => setCodeAnalytique(e.target.value)} style={{ width: 190 }}>
                <option value="">— À ventiler —</option>
                {codes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
            <button className="btn btn-secondary" type="submit" disabled={ajouterLigne.isPending}>
              Ajouter la ligne
            </button>
          </form>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Nature</th>
              <th>Ouvrage</th>
              <th>Code analytique</th>
              <th style={{ width: 100, textAlign: 'right' }}>Qté</th>
              <th style={{ width: 110, textAlign: 'right' }}>PU</th>
              <th style={{ width: 130, textAlign: 'right' }}>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            {f.lignes.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.ressource_code && <span className="code-cell" style={{ marginRight: 6 }}>{l.ressource_code}</span>}
                  {l.designation}
                </td>
                <td className="muted">{NATURES[l.nature] ?? l.nature}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.ouvrage ?? '—'}</td>
                <td>{l.code_analytique
                  ? <span className="code-cell">{l.code_analytique}</span>
                  : <span className="muted">À ventiler</span>}</td>
                <td style={{ textAlign: 'right' }}>{Number(l.quantity)} {l.unite_achat ?? ''}</td>
                <td style={{ textAlign: 'right' }}>{euro(l.unit_price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(l.amount_ht)}
                </td>
              </tr>
            ))}
            {f.lignes.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Cette commande n’a aucune ligne.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <div className="card" style={{ flex: '1 1 300px', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <PackageCheck size={15} /><strong style={{ fontSize: 13 }}>Réceptions</strong>
          </div>
          {f.receptions.length === 0
            ? <span className="muted" style={{ fontSize: 12 }}>Rien de reçu pour l’instant.</span>
            : f.receptions.map((d) => (
              <div key={d.id} style={{ fontSize: 12, padding: '2px 0' }}>
                <span className="code-cell">{d.code}</span>
                <span className="muted"> · {jour(d.received_at)}</span>
              </div>
            ))}
          {envoyee && (
            <button
              className="btn btn-secondary"
              style={{ marginTop: 10 }}
              disabled={receptionner.isPending}
              onClick={() => receptionner.mutate()}
              title="Enregistre un bon de livraison ; son numéro suit la numérotation société"
            >
              {receptionner.isPending ? 'Enregistrement…' : 'Réceptionner'}
            </button>
          )}
        </div>
        <div className="card" style={{ flex: '1 1 300px', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ReceiptText size={15} /><strong style={{ fontSize: 13 }}>Factures</strong>
            {f.factures.length > 0 && (
              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{euro(factureTotal.toFixed(2))}</span>
            )}
          </div>
          {f.factures.length === 0
            ? <span className="muted" style={{ fontSize: 12 }}>Aucune facture rattachée.</span>
            : f.factures.map((x) => (
              <div key={x.id} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 8 }}>
                <span className="code-cell">{x.code}</span>
                <span className="muted">{jour(x.invoice_date)}</span>
                <span style={{ marginLeft: 'auto' }}>{euro(x.amount_ht)}</span>
              </div>
            ))}
          {envoyee && (
            <form
              style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}
              onSubmit={(e) => { e.preventDefault(); if (factureCode && factureMontant) enregistrerFacture.mutate(); }}
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <label>N° facture</label>
                <input value={factureCode} onChange={(e) => setFactureCode(e.target.value)} style={{ width: 120 }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Nature</label>
                <select value={factureNature} onChange={(e) => setFactureNature(e.target.value)} style={{ width: 130 }}>
                  {NATURES_SAISIE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Montant HT</label>
                <input type="number" min={0} step="0.01" value={factureMontant}
                  onChange={(e) => setFactureMontant(e.target.value)} style={{ width: 110, textAlign: 'right' }} />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={enregistrerFacture.isPending}>
                Enregistrer
              </button>
            </form>
          )}
        </div>
      </div>

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
