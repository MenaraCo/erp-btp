'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';

interface LigneBon {
  id: string;
  libelle: string;
  montant: string;
  quantite: string;
  nature: string;
  statut: string;
  accepte: boolean;
  code_analytique_id: string | null;
  code_analytique: string | null;
  code_label: string | null;
  categorie: string;
}
interface Bon {
  id: string; numero: string; date: string; libelle: string; source: string; statut: string;
  marche_code: string | null; lignes: LigneBon[];
}
interface Traitement {
  traitees: number;
  enAttente: number;
  anomalies: Array<{ ligne: string; raison: string }>;
}

/**
 * Les BONS DE BUDGET à traiter — ce qui arrive du devis attend une décision.
 *
 * Les frais généraux et les frais annexes d'un devis ne sont pas des ouvrages : leur poste
 * analytique et leur SIGNE relèvent de la conduite du chantier. Un compte prorata retenu par le
 * client est une recette en moins ; le même intitulé, ailleurs, sera une dépense. L'application ne
 * tranche donc pas : elle présente, on renseigne, on accepte, on traite (guide Onaya §5.10).
 *
 * Tant qu'une ligne n'est pas traitée, elle ne pèse sur aucun total — ni charge, ni produit, ni
 * résultat. C'est ce qui rend l'attente sans danger.
 */
export function BonsDeBudget({ chantierId }: { chantierId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [bilan, setBilan] = useState<Traitement | null>(null);

  const bons = useQuery({
    queryKey: ['budgets-bons', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Bon[]>(`/chantiers/${chantierId}/budgets/bons`, { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const rafraichir = () => {
    for (const key of [
      ['budgets-bons', chantierId], ['budgets', chantierId], ['budgets-historique', chantierId],
      ['budgets-ressources', chantierId], ['chantier-analytical', chantierId],
      ['chantier-results', chantierId], ['chantier-forecast', chantierId], ['pilotage', chantierId],
      ['portfolio'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const mLigne = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/chantiers/${chantierId}/budgets/bons/lignes/${id}`, { method: 'PATCH', token, body }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mAccepter = useMutation({
    mutationFn: ({ id, accepte }: { id: string; accepte: boolean }) =>
      apiFetch(`/chantiers/${chantierId}/budgets/bons/lignes/${id}/acceptation`, {
        method: 'POST', token, body: { accepte },
      }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mSupprimer = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/chantiers/${chantierId}/budgets/bons/lignes/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mTraiter = useMutation({
    mutationFn: (documentId: string) =>
      apiFetch<Traitement>(`/chantiers/${chantierId}/budgets/bons/${documentId}/traiter`, {
        method: 'POST', token,
      }),
    onSuccess: (r) => { setErr(null); setBilan(r); rafraichir(); }, onError: onErr,
  });

  const enAttente = (bons.data ?? []).filter((b) => b.statut === 'a_traiter');
  if (!bons.data || enAttente.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16, borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Inbox size={16} />
        <h2 style={{ margin: 0 }}>Budgets à traiter</h2>
        <Badge ton="attention">{enAttente.length} bon{enAttente.length > 1 ? 's' : ''}</Badge>
      </div>
      <p className="muted" style={{ marginTop: 6, maxWidth: 780 }}>
        Repris du devis, ces montants attendent votre décision : à quel <strong>poste analytique</strong> les
        rattacher, et avec quel <strong>signe</strong>. Un compte prorata retenu par le client se saisit en
        négatif sur un poste de produits ; une installation de chantier reste une charge. Tant qu'une ligne
        n'est pas traitée, elle ne compte dans aucun total.
      </p>

      {err && <Alerte>{err}</Alerte>}
      {bilan && (
        <Alerte ton={bilan.anomalies.length > 0 ? 'danger' : 'succes'}>
          {bilan.traitees} ligne{bilan.traitees > 1 ? 's' : ''} traitée{bilan.traitees > 1 ? 's' : ''}
          {bilan.anomalies.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {bilan.anomalies.map((a, i) => (
                <li key={i}><strong>{a.ligne}</strong> — {a.raison}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}

      {enAttente.map((bon) => (
        <div key={bon.id} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong>{bon.numero}</strong>
            <span className="muted">{bon.libelle}</span>
            {bon.marche_code && <span className="muted">· marché {bon.marche_code}</span>}
            <span className="muted" style={{ fontSize: 12 }}>
              {new Date(bon.date).toLocaleDateString('fr-FR')}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Bouton
                variante="secondaire"
                icone={Check}
                disabled={mAccepter.isPending}
                onClick={() => {
                  setBilan(null);
                  for (const l of bon.lignes.filter((x) => !x.accepte)) {
                    mAccepter.mutate({ id: l.id, accepte: true });
                  }
                }}
              >
                Tout accepter
              </Bouton>
              <Bouton
                disabled={mTraiter.isPending || bon.lignes.every((l) => !l.accepte)}
                onClick={() => { setBilan(null); mTraiter.mutate(bon.id); }}
              >
                Traiter les lignes acceptées
              </Bouton>
            </div>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="grid" style={{ margin: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Accepter</th>
                  <th>Libellé</th>
                  <th style={{ width: 150 }}>Poste analytique</th>
                  <th style={{ textAlign: 'right', width: 140 }}>Montant (signé)</th>
                  <th style={{ width: 110 }}>Bloc</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {bon.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={l.accepte}
                        disabled={mAccepter.isPending}
                        onChange={(e) => mAccepter.mutate({ id: l.id, accepte: e.target.checked })}
                      />
                    </td>
                    <td>{l.libelle}</td>
                    <td>
                      <SelectCodeAnalytique
                        valeur={l.code_analytique_id}
                        codes={codes.data ?? []}
                        obligatoire
                        // Les trois catégories : c'est ici qu'on décide si c'est une charge, un
                        // frais général ou une recette.
                        categories={['charge', 'frais_generaux', 'produit']}
                        onChange={(id) => mLigne.mutate({ id: l.id, body: { codeAnalytiqueId: id } })}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <MontantSigne
                        valeur={l.montant}
                        onSubmit={(montant) => mLigne.mutate({ id: l.id, body: { montant } })}
                        disabled={mLigne.isPending}
                      />
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {l.code_analytique_id
                        ? { charge: 'Charges', frais_generaux: 'Frais généraux', produit: 'Produits' }[l.categorie]
                        : '— à choisir'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        title="Retirer cette ligne du bon"
                        onClick={() => mSupprimer.mutate(l.id)}
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
        </div>
      ))}
    </div>
  );
}

/** Saisie d'un montant signé : validée à la sortie du champ ou par Entrée. */
function MontantSigne({
  valeur, onSubmit, disabled,
}: {
  valeur: string;
  onSubmit: (montant: string) => void;
  disabled: boolean;
}) {
  const [v, setV] = useState(valeur);
  const dirty = v !== valeur;
  const negatif = Number(v) < 0;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
      <input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (dirty && v.trim() !== '' && !Number.isNaN(Number(v))) onSubmit(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          width: 100, textAlign: 'right', padding: '2px 6px',
          borderColor: dirty ? 'var(--accent)' : undefined,
          color: negatif ? 'var(--danger)' : undefined,
        }}
      />
      <span className="muted" style={{ fontSize: 11 }}>{euro(v)}</span>
    </span>
  );
}
