'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Wallet } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, LigneVide } from '@/components/ui';

interface Rubrique {
  id: string;
  code: string;
  label: string;
  type: 'panier' | 'deplacement' | 'prime' | 'heures_sup' | 'autre';
  unite: 'jour' | 'heure' | 'forfait';
  montant_unitaire: string;
  seuil_debut: string | null;
  seuil_fin: string | null;
  majoration: string | null;
  actif: boolean;
}

const TYPES: Array<{ v: Rubrique['type']; l: string; aide: string }> = [
  { v: 'panier', l: 'Panier', aide: 'Posé automatiquement : un par jour travaillé.' },
  { v: 'deplacement', l: 'Déplacement', aide: 'Posé automatiquement : un par jour travaillé.' },
  { v: 'heures_sup', l: 'Heures supplémentaires', aide: 'Calculé par semaine, sur la tranche indiquée.' },
  { v: 'prime', l: 'Prime', aide: 'Saisie à la main sur le relevé du mois.' },
  { v: 'autre', l: 'Autre', aide: 'Saisie à la main sur le relevé du mois.' },
];
const UNITES: Array<{ v: Rubrique['unite']; l: string }> = [
  { v: 'jour', l: 'Jour' }, { v: 'heure', l: 'Heure' }, { v: 'forfait', l: 'Forfait' },
];

/**
 * Rubriques de paye — les éléments variables qui s'ajoutent aux heures.
 *
 * Paniers et déplacements se posent seuls (un par jour travaillé) ; les heures supplémentaires se
 * calculent par semaine sur la tranche paramétrée ici. Primes et « autres » restent des saisies
 * du conducteur : aucune règle ne devine une prime.
 */
export default function RubriquesPayePage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [toutes, setToutes] = useState(false);

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<Rubrique['type']>('panier');
  const [unite, setUnite] = useState<Rubrique['unite']>('jour');
  const [montant, setMontant] = useState('');
  const [seuilDebut, setSeuilDebut] = useState('35');
  const [seuilFin, setSeuilFin] = useState('43');
  const [majoration, setMajoration] = useState('25');

  const liste = useQuery({
    queryKey: ['paye-rubriques', toutes],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Rubrique[]>(`/paye/rubriques${toutes ? '?toutes=1' : ''}`, { token }),
  });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ['paye-rubriques'] });

  const creer = useMutation({
    mutationFn: () => apiFetch('/paye/rubriques', {
      method: 'POST',
      token,
      body: {
        code, label, type, unite,
        montantUnitaire: montant || '0',
        // La tranche et la majoration n'ont de sens que pour des heures supplémentaires.
        seuilDebut: type === 'heures_sup' ? seuilDebut : null,
        seuilFin: type === 'heures_sup' ? (seuilFin || null) : null,
        majoration: type === 'heures_sup' && majoration ? String(Number(majoration) / 100) : null,
      },
    }),
    onSuccess: () => { setErr(null); setCode(''); setLabel(''); setMontant(''); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Création impossible.'),
  });

  const basculer = useMutation({
    mutationFn: (r: Rubrique) => apiFetch(`/paye/rubriques/${r.id}`, {
      method: 'PATCH', token, body: { actif: !r.actif },
    }),
    onSuccess: rafraichir,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Modification impossible.'),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => apiFetch(`/paye/rubriques/${id}`, { method: 'DELETE', token }),
    onSuccess: rafraichir,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible.'),
  });

  const aide = TYPES.find((t) => t.v === type)?.aide;

  return (
    <div>
      <h1 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wallet size={20} /> Rubriques de paye
      </h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
        Les éléments variables qui s’ajoutent aux heures. Paniers et déplacements se posent seuls,
        un par jour travaillé ; les heures supplémentaires se calculent par semaine sur la tranche
        indiquée. Les primes restent une décision, donc une saisie.
      </p>

      {err && <Alerte>{err}</Alerte>}

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Nouvelle rubrique</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 90 }} placeholder="PAN" />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>Libellé</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Panier repas" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as Rubrique['type'])}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Unité</label>
            <select value={unite} onChange={(e) => setUnite(e.target.value as Rubrique['unite'])}>
              {UNITES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
            </select>
          </div>
          {type === 'heures_sup' ? (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>De (h/semaine)</label>
                <input type="number" step="0.5" value={seuilDebut} onChange={(e) => setSeuilDebut(e.target.value)} style={{ width: 90, textAlign: 'right' }} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>À (h/semaine)</label>
                <input type="number" step="0.5" value={seuilFin} onChange={(e) => setSeuilFin(e.target.value)} style={{ width: 90, textAlign: 'right' }} placeholder="sans limite" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Majoration (%)</label>
                <input type="number" step="1" value={majoration} onChange={(e) => setMajoration(e.target.value)} style={{ width: 90, textAlign: 'right' }} />
              </div>
            </>
          ) : (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Montant unitaire</label>
              <input type="number" step="0.01" value={montant} onChange={(e) => setMontant(e.target.value)} style={{ width: 110, textAlign: 'right' }} />
            </div>
          )}
          <Bouton
            chargement={creer.isPending}
            libelleChargement="Création…"
            disabled={!code.trim() || !label.trim()}
            onClick={() => { setErr(null); creer.mutate(); }}
          >
            Ajouter
          </Bouton>
        </div>
        {aide && <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>{aide}</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
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
              <th style={{ width: 100 }}>État</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="code-cell">{r.code}</td>
                <td>{r.label}</td>
                <td>{TYPES.find((t) => t.v === r.type)?.l ?? r.type}</td>
                <td className="muted">{UNITES.find((u) => u.v === r.unite)?.l ?? r.unite}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.type === 'heures_sup'
                    ? `${Number(r.seuil_debut ?? 0)} → ${r.seuil_fin ? Number(r.seuil_fin) : '∞'} h · +${Math.round(Number(r.majoration ?? 0) * 100)} %`
                    : euro(r.montant_unitaire)}
                </td>
                <td>
                  <button
                    className="btn-ghost"
                    title={r.actif ? 'Désactiver' : 'Réactiver'}
                    onClick={() => basculer.mutate(r)}
                  >
                    <Badge ton={r.actif ? 'succes' : 'neutre'}>{r.actif ? 'Active' : 'Désactivée'}</Badge>
                  </button>
                </td>
                <td style={{ textAlign: 'right' }}>
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
                colonnes={7}
                icone={Wallet}
                titre="Aucune rubrique de paye."
                indice="Commencez par le panier repas : c’est celui qui revient tous les jours."
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
