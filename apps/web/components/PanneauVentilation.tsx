'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, EtatVide } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';

type TypeVentilable = 'ressource' | 'commande' | 'facture' | 'pointage' | 'materiel';

interface Ligne {
  id: string;
  code?: string | null;
  piece?: string | null;
  label?: string | null;
  nature?: string | null;
  date?: string | null;
  hours?: string | null;
  montant: string;
  fige?: boolean;
  status?: string | null;
}
interface AVentiler {
  ressources: Ligne[];
  commandes: Ligne[];
  factures: Ligne[];
  pointages: Ligne[];
  materiel: Ligne[];
  totaux: { budget: string; engage: string; realise: string };
  figes: number;
}

const SECTIONS: Array<{ cle: keyof AVentiler & TypeVentilableCle; type: TypeVentilable; titre: string; axe: string }> = [
  { cle: 'ressources', type: 'ressource', titre: 'Ressources du budget', axe: 'Budget' },
  { cle: 'commandes', type: 'commande', titre: 'Lignes de commande', axe: 'Engagé' },
  { cle: 'factures', type: 'facture', titre: 'Factures fournisseur', axe: 'Réalisé' },
  { cle: 'pointages', type: 'pointage', titre: 'Heures pointées', axe: 'Réalisé' },
  { cle: 'materiel', type: 'materiel', titre: 'Utilisation de matériel', axe: 'Réalisé' },
];
type TypeVentilableCle = 'ressources' | 'commandes' | 'factures' | 'pointages' | 'materiel';

/**
 * « 999 — À ventiler », mais avec de quoi agir.
 *
 * Une dépense sans code analytique compte dans le total du chantier et dans aucun poste : le
 * tableau de bord la montre sans jamais permettre de la ranger. Ce panneau la liste — budget,
 * engagé ET réalisé — et l'impute d'un clic, là où le travail se fait : dans la structure du
 * chantier, pas dans le tableau de résultats.
 *
 * L'imputation reste corrigeable ensuite : on découvre en cours de chantier qu'une ressource
 * était du matériel et non de la main-d'œuvre. Seules les heures d'un mois arrêté résistent — les
 * reclasser changerait un résultat déjà publié.
 */
export function PanneauVentilation({ chantierId }: { chantierId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const liste = useQuery({
    queryKey: ['a-ventiler', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<AVentiler>(`/chantiers/${chantierId}/a-ventiler`, { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const imputer = useMutation({
    mutationFn: (v: { type: TypeVentilable; id: string; codeAnalytiqueId: string | null }) =>
      apiFetch(`/chantiers/${chantierId}/ventilation/${v.type}/${v.id}`, {
        method: 'PATCH', token, body: { codeAnalytiqueId: v.codeAnalytiqueId },
      }),
    onSuccess: () => {
      setErr(null);
      for (const key of ['a-ventiler', 'chantier-analytical', 'chantier-results', 'execution-tree', 'chantier']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Imputation impossible.'),
  });

  const d = liste.data;
  const total = d
    ? Number(d.totaux.budget) + Number(d.totaux.engage) + Number(d.totaux.realise) : 0;
  const rien = d && SECTIONS.every((s) => (d[s.cle] as Ligne[]).length === 0);

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Scale size={15} />
        <strong style={{ fontSize: 13 }}>À ventiler</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          Budget {euro(d?.totaux.budget ?? '0')} · Engagé {euro(d?.totaux.engage ?? '0')} ·
          {' '}Réalisé {euro(d?.totaux.realise ?? '0')}
        </span>
        {total > 0 && (
          <span style={{ marginLeft: 'auto' }}>
            <Badge ton="attention">{euro(total.toFixed(2))} sans poste</Badge>
          </span>
        )}
      </div>

      {err && <div style={{ padding: '0 14px' }}><Alerte>{err}</Alerte></div>}

      {rien && (
        <EtatVide
          icone={Scale}
          titre="Tout est ventilé."
          indice="Chaque dépense de ce chantier porte un code analytique : les résultats par poste sont complets."
        />
      )}

      {d && !rien && (
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Axe</th>
              <th style={{ width: 110 }}>Pièce</th>
              <th>Désignation</th>
              <th style={{ width: 110, textAlign: 'right' }}>Montant</th>
              <th style={{ width: 170 }}>Code analytique</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.flatMap((s) => {
              const lignes = d[s.cle] as Ligne[];
              if (lignes.length === 0) return [];
              return [
                <tr key={s.cle} style={{ background: 'var(--surface)' }}>
                  <td colSpan={5} style={{ fontWeight: 600, fontSize: 12 }}>
                    {s.titre}
                    <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>,
                ...lignes.map((l) => (
                  <tr key={`${s.cle}-${l.id}`}>
                    <td className="muted" style={{ fontSize: 11 }}>{s.axe}</td>
                    <td className="code-cell">{l.piece ?? l.code ?? '—'}</td>
                    <td>
                      {l.label ?? '—'}
                      {l.date && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{l.date}</span>}
                      {l.hours && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{Number(l.hours)} h</span>}
                      {l.fige && (
                        <span style={{ color: 'var(--danger)', fontSize: 11, marginLeft: 8 }}>
                          mois arrêté
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {euro(l.montant)}
                    </td>
                    <td>
                      {/* Choisir ici range la ligne immédiatement : c'est le geste attendu, pas un
                          formulaire à valider. */}
                      <SelectCodeAnalytique
                        valeur={null}
                        codes={codes.data ?? []}
                        obligatoire
                        lecture={Boolean(l.fige)}
                        onChange={(id) => id && imputer.mutate({ type: s.type, id: l.id, codeAnalytiqueId: id })}
                      />
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
