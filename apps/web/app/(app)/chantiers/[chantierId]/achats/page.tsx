'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

interface Commande {
  id: string;
  code: string;
  statut: string;
  totalHt: string;
  valideLe: string | null;
  creeLe: string;
  fournisseur: string | null;
  nbLignes: number;
  nbReceptions: number;
  nbFactures: number;
}
interface Registre { lignes: Commande[]; total: number; montantTotal: string }
interface Summary { engageTotal: string; realiseTotal: string }

const STATUTS: Record<string, string> = {
  draft: 'Brouillon', pending_approval: 'À valider', validated: 'Envoyée', cancelled: 'Annulée',
};
const BADGE: Record<string, string> = {
  draft: 'info', pending_approval: 'warning', validated: 'success', cancelled: 'danger',
};

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Achats d'un chantier — la même liste que le registre d'entreprise, filtrée sur ce chantier.
 *
 * L'écran dépliait chaque commande avec ses lignes : à vingt commandes, il fallait faire défiler
 * des centaines de lignes pour retrouver la bonne. Une commande n'est ici qu'une ligne ; elle
 * s'ouvre sur sa fiche, où l'on saisit, envoie, réceptionne et facture.
 */
export default function AchatsChantierPage() {
  const { token } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ chantier: { code: string } }>(`/chantiers/${chantierId}`, { token }),
  });
  const requete = new URLSearchParams({ chantier: chantierId, parPage: '100' });
  if (recherche) requete.set('q', recherche);
  if (statut) requete.set('statut', statut);

  const registre = useQuery({
    queryKey: ['achats-commandes', requete.toString()],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Registre>(`/achats/commandes?${requete.toString()}`, { token }),
  });
  const summary = useQuery({
    queryKey: ['purchasing-summary', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Summary>(`/chantiers/${chantierId}/purchasing-summary`, { token }),
  });

  const creer = useMutation({
    mutationFn: () => apiFetch<{ id: string }>(`/chantiers/${chantierId}/purchase-orders`, {
      method: 'POST', token, body: {},
    }),
    onSuccess: (bc) => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['achats-commandes'] });
      // On ouvre la commande créée : c'est là qu'on la remplit — sans quitter le chantier.
      router.push(`/chantiers/${chantierId}/achats/${bc.id}`);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Création impossible.'),
  });

  const r = registre.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">
          ← Chantier {chantier.data?.chantier.code ?? ''}
        </Link>
      </p>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShoppingCart size={20} /> Achats du chantier
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Commande → réception → facture. L’engagé est compté dès l’envoi du bon de commande ; le
        réalisé, à la facture. Ouvrez une commande pour la remplir, l’envoyer ou la réceptionner.
      </p>

      {summary.data && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card">
            <h2>Engagé (commandes envoyées)</h2>
            <div className="stat">{euro(summary.data.engageTotal)}</div>
          </div>
          <div className="card">
            <h2>Réalisé (factures)</h2>
            <div className="stat">{euro(summary.data.realiseTotal)}</div>
          </div>
        </div>
      )}

      {registre.isError && (
        <p className="muted" style={{ marginTop: 12 }}>
          Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.
        </p>
      )}
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Recherche</label>
          <input
            value={recherche}
            placeholder="N° de commande, fournisseur…"
            onChange={(e) => setRecherche(e.target.value)}
            style={{ width: 240 }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Statut</label>
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="">Tous</option>
            <option value="draft">Brouillon</option>
            <option value="pending_approval">À valider</option>
            <option value="validated">Envoyée</option>
            <option value="cancelled">Annulée</option>
          </select>
        </div>
        <button
          className="btn"
          style={{ marginLeft: 'auto' }}
          disabled={creer.isPending}
          onClick={() => { setErr(null); creer.mutate(); }}
        >
          {creer.isPending ? 'Création…' : '+ Nouveau bon de commande'}
        </button>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>N°</th>
              <th>Fournisseur</th>
              <th style={{ width: 110 }}>Date</th>
              <th style={{ width: 100 }}>Statut</th>
              <th style={{ width: 70, textAlign: 'right' }}>Lignes</th>
              <th style={{ width: 130, textAlign: 'right' }}>Montant HT</th>
              <th style={{ width: 120 }}>Suivi</th>
            </tr>
          </thead>
          <tbody>
            {(r?.lignes ?? []).map((c) => (
              <tr
                key={c.id}
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/chantiers/${chantierId}/achats/${c.id}`)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <td className="code-cell">{c.code}</td>
                <td>{c.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
                <td className="muted">{jour(c.valideLe ?? c.creeLe)}</td>
                <td><span className={`badge ${BADGE[c.statut] ?? 'info'}`}>{STATUTS[c.statut] ?? c.statut}</span></td>
                <td style={{ textAlign: 'right' }}>{c.nbLignes}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {euro(c.totalHt)}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {c.nbReceptions > 0 && `${c.nbReceptions} BL`}
                  {c.nbReceptions > 0 && c.nbFactures > 0 && ' · '}
                  {c.nbFactures > 0 && `${c.nbFactures} fact.`}
                  {c.nbReceptions === 0 && c.nbFactures === 0 && '—'}
                </td>
              </tr>
            ))}
            {r && r.lignes.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 20, textAlign: 'center' }}>
                  Aucune commande sur ce chantier pour l’instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {r && r.lignes.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: 'right' }}>
          {r.total} commande{r.total > 1 ? 's' : ''} · {euro(r.montantTotal)}
        </div>
      )}
    </div>
  );
}
