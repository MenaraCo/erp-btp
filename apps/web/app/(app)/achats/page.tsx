'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { teinteChantier } from '@/components/CalendrierMois';
import { BarreRecherche, Pagination, useRegistre } from '@/components/RegistreAchats';
import { STATUT_COMMANDE, statut } from '@/lib/statuts';
import { BadgeStatut, LigneVide } from '@/components/ui';

interface Commande {
  id: string;
  code: string;
  statut: string;
  totalHt: string;
  valideLe: string | null;
  creeLe: string;
  chantierId: string;
  chantierCode: string | null;
  chantierNom: string | null;
  chantierCouleur: string | null;
  fournisseur: string | null;
  nbLignes: number;
  nbReceptions: number;
  nbFactures: number;
}
interface Reponse { lignes: Commande[]; total: number; montantTotal: string; page: number; parPage: number }

// Les libellés viennent du registre des statuts : le filtre et la colonne disent la même chose.
const STATUTS = Object.entries(STATUT_COMMANDE).map(([value, s]) => ({ value, label: s.label }));

function jour(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('fr-FR') : '—';
}

/**
 * Registre des bons de commande — toute l'entreprise, pas un chantier.
 *
 * Une commande n'est ici qu'une ligne : à cinquante commandes de cinquante lignes, l'ancien écran
 * dépliant était illisible. Le détail s'ouvre sur sa propre page, et la recherche remplace le
 * défilement.
 */
export default function CommandesPage() {
  const { token } = useAuth();
  const router = useRouter();
  const { filtres, majFiltres, page, setPage, requete } = useRegistre();

  const data = useQuery({
    queryKey: ['achats-commandes', requete],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Reponse>(`/achats/commandes?${requete}`, { token }),
  });
  const r = data.data;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShoppingCart size={20} /> Bons de commande
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Toutes les commandes de l’entreprise. Cherchez par numéro, fournisseur, chantier ou période ;
        cliquez une ligne pour ouvrir la commande.
      </p>

      <BarreRecherche
        filtres={filtres}
        onChange={majFiltres}
        statuts={STATUTS}
        total={r?.total ?? 0}
        montant={r ? euro(r.montantTotal) : null}
      />

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 140 }}>N°</th>
              <th>Chantier</th>
              <th>Fournisseur</th>
              <th style={{ width: 110 }}>Date</th>
              <th style={{ width: 90 }}>Statut</th>
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
                onClick={() => router.push(`/achats/${c.id}`)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <td className="code-cell">{c.code}</td>
                <td>
                  <span style={{
                    display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 7,
                    background: teinteChantier(c.chantierId, c.chantierCouleur),
                  }} />
                  {c.chantierCode ?? '—'}
                  <span className="muted"> {c.chantierNom}</span>
                </td>
                <td>{c.fournisseur ?? <span className="muted">Non renseigné</span>}</td>
                <td className="muted">{jour(c.valideLe ?? c.creeLe)}</td>
                <td><BadgeStatut statut={statut(STATUT_COMMANDE, c.statut)} /></td>
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
              <LigneVide
                colonnes={8}
                icone={ShoppingCart}
                titre="Aucune commande ne correspond à cette recherche."
                indice="Une commande se crée depuis le chantier concerné, pour qu’elle en porte le budget."
              />
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={r?.total ?? 0} parPage={r?.parPage ?? 25} onPage={setPage} />
    </div>
  );
}
