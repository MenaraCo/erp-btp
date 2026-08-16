'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, LigneVide } from '@/components/ui';
import {
  NATURES_RUBRIQUE, Rubrique, RubriqueModal, TYPES_RUBRIQUE, UNITES_RUBRIQUE,
} from '@/components/RubriqueModal';

/**
 * Rubriques de paye — les éléments variables qui s'ajoutent aux heures.
 *
 * Paniers et déplacements se posent seuls (un par jour travaillé) ; les heures supplémentaires se
 * calculent par semaine sur la tranche paramétrée. Primes et « autres » restent des saisies du
 * conducteur : aucune règle ne devine une prime.
 *
 * Chaque rubrique s'ouvre en fiche : un montant de panier change tous les ans, un taux se corrige.
 */
export default function RubriquesPayePage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [toutes, setToutes] = useState(false);
  const [fiche, setFiche] = useState<Rubrique | null | undefined>(undefined);

  const liste = useQuery({
    queryKey: ['paye-rubriques', toutes],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Rubrique[]>(`/paye/rubriques${toutes ? '?toutes=1' : ''}`, { token }),
  });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ['paye-rubriques'] });

  const supprimer = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ desactivee: boolean }>(`/paye/rubriques/${id}`, { method: 'DELETE', token }),
    onSuccess: (r) => {
      setErr(r.desactivee
        ? 'Cette rubrique figure déjà sur des relevés : elle a été désactivée plutôt que supprimée, pour ne pas réécrire le passé.'
        : null);
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible.'),
  });

  const regle = (r: Rubrique) => (r.type === 'heures_sup'
    ? `${Number(r.seuil_debut ?? 0)} → ${r.seuil_fin ? Number(r.seuil_fin) : '∞'} h · +${Math.round(Number(r.majoration ?? 0) * 100)} %`
    : euro(r.montant_unitaire));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wallet size={20} /> Rubriques de paye
        </h1>
        <span style={{ marginLeft: 'auto' }}>
          <Bouton icone={Plus} onClick={() => { setErr(null); setFiche(null); }}>Nouvelle rubrique</Bouton>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 4, maxWidth: 820 }}>
        Les éléments variables qui s’ajoutent aux heures. Paniers et déplacements se posent seuls,
        un par jour travaillé ; les heures supplémentaires se calculent par semaine sur la tranche
        indiquée. Les primes restent une décision, donc une saisie.
      </p>

      {err && <Alerte>{err}</Alerte>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
          Afficher les rubriques désactivées
        </label>
      </div>

      <div className="card" style={{ marginTop: 8, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Code</th>
              <th>Libellé</th>
              <th style={{ width: 160 }}>Type</th>
              <th style={{ width: 80 }}>Unité</th>
              <th style={{ width: 150, textAlign: 'right' }}>Montant / règle</th>
              <th style={{ width: 140 }}>Imputation</th>
              <th style={{ width: 100 }}>État</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).map((r) => (
              <tr
                key={r.id}
                style={{ cursor: 'pointer', opacity: r.actif ? 1 : 0.55 }}
                onClick={() => { setErr(null); setFiche(r); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <td className="code-cell">{r.code}</td>
                <td>{r.label}</td>
                <td>{TYPES_RUBRIQUE.find((t) => t.v === r.type)?.l ?? r.type}</td>
                <td className="muted">{UNITES_RUBRIQUE.find((u) => u.v === r.unite)?.l ?? r.unite}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{regle(r)}</td>
                <td>
                  {/* Sans poste analytique, la dépense n'entre dans aucun tableau de bord. */}
                  {r.code_analytique_id
                    ? (
                      <span>
                        <span className="code-cell">{r.code_analytique ?? '—'}</span>
                        <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                          {NATURES_RUBRIQUE.find((n) => n.v === r.nature)?.l ?? r.nature}
                        </span>
                      </span>
                    )
                    : <Badge ton="attention">Non imputée</Badge>}
                </td>
                <td><Badge ton={r.actif ? 'succes' : 'neutre'}>{r.actif ? 'Active' : 'Désactivée'}</Badge></td>
                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn-ghost" title="Ouvrir la fiche" onClick={() => setFiche(r)}>
                    <Pencil size={13} />
                  </button>
                  <button
                    className="btn-ghost"
                    title="Supprimer (désactivée si déjà employée)"
                    onClick={() => supprimer.mutate(r.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {liste.data && liste.data.length === 0 && (
              <LigneVide
                colonnes={8}
                icone={Wallet}
                titre="Aucune rubrique de paye."
                indice="Commencez par le panier repas : c’est celui qui revient tous les jours."
              />
            )}
          </tbody>
        </table>
      </div>

      {fiche !== undefined && (
        <RubriqueModal rubrique={fiche} onClose={() => { setFiche(undefined); rafraichir(); }} />
      )}
    </div>
  );
}
