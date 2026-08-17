'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';

interface Fournisseur { id: string; name: string }

export interface ElementInterim {
  id?: string;
  type: 'panier' | 'trajet' | 'transport' | 'ifm' | 'iccp' | 'prime' | 'autre';
  label?: string;
  montant: string;
  unite: 'jour' | 'heure' | 'forfait' | 'pourcentage';
  code_analytique_id?: string | null;
  codeAnalytiqueId?: string | null;
}

export interface ContratInterim {
  id: string;
  supplier_id: string | null;
  fournisseur: string | null;
  agence: string | null;
  reference: string | null;
  date_debut: string;
  date_fin: string | null;
  taux_horaire: string;
  coefficient: string;
  taux_facture: string;
  code_analytique_id: string | null;
  code_analytique: string | null;
  commentaire: string | null;
  elements: ElementInterim[];
}

const TYPES: Array<{ v: ElementInterim['type']; l: string }> = [
  { v: 'panier', l: 'Panier repas' },
  { v: 'trajet', l: 'Indemnité de trajet' },
  { v: 'transport', l: 'Indemnité de transport' },
  { v: 'ifm', l: 'Fin de mission (IFM)' },
  { v: 'iccp', l: 'Congés payés (ICCP)' },
  { v: 'prime', l: 'Prime' },
  { v: 'autre', l: 'Autre indemnité' },
];
const UNITES: Array<{ v: ElementInterim['unite']; l: string }> = [
  { v: 'jour', l: '€ / jour' },
  { v: 'heure', l: '€ / heure' },
  { v: 'forfait', l: '€ forfait' },
  { v: 'pourcentage', l: '% du salaire' },
];

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Contrat d'intérim d'un salarié — l'agence, les termes, les indemnités.
 *
 * Un intérimaire n'est pas une ligne de paye : c'est un achat d'heures. L'agence facture le taux
 * horaire MULTIPLIÉ par son coefficient, puis ajoute paniers, trajets, fin de mission et congés
 * payés. Le taux facturé s'affiche donc en clair, à côté du taux nu : c'est lui qui sera compté
 * sur chaque heure pointée.
 */
export function ContratInterimBloc({ employeeId }: { employeeId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<null | {
    id?: string;
    supplierId: string;
    reference: string;
    dateDebut: string;
    dateFin: string;
    tauxHoraire: string;
    coefficient: string;
    codeAnalytiqueId: string | null;
    elements: ElementInterim[];
  }>(null);

  const contrats = useQuery({
    queryKey: ['interim-contracts', employeeId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<ContratInterim[]>(`/employees/${employeeId}/interim-contracts`, { token }),
  });
  const fournisseurs = useQuery({
    queryKey: ['suppliers-filtre'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<{ rows: Fournisseur[] }>('/suppliers?sort=name&pageSize=100', { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const rafraichir = () => qc.invalidateQueries({ queryKey: ['interim-contracts', employeeId] });
  const echoue = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Opération impossible.');

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps = {
        supplierId: saisie?.supplierId || null,
        reference: saisie?.reference || null,
        dateDebut: saisie?.dateDebut,
        dateFin: saisie?.dateFin || null,
        tauxHoraire: saisie?.tauxHoraire || '0',
        coefficient: saisie?.coefficient || '1',
        codeAnalytiqueId: saisie?.codeAnalytiqueId ?? null,
        elements: (saisie?.elements ?? []).map((e) => ({
          type: e.type, montant: e.montant || '0', unite: e.unite,
          codeAnalytiqueId: e.codeAnalytiqueId ?? e.code_analytique_id ?? null,
        })),
      };
      return saisie?.id
        ? apiFetch(`/employees/interim-contracts/${saisie.id}`, { method: 'PATCH', token, body: corps })
        : apiFetch(`/employees/${employeeId}/interim-contracts`, { method: 'POST', token, body: corps });
    },
    onSuccess: () => { setErr(null); setSaisie(null); rafraichir(); },
    onError: echoue,
  });

  const supprimer = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/employees/interim-contracts/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: echoue,
  });

  const facture = saisie
    ? Number(saisie.tauxHoraire || 0) * Number(saisie.coefficient || 0)
    : 0;

  return (
    <div>
      <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Contrats d’intérim
        <span style={{ marginLeft: 'auto' }}>
          <Bouton
            variante="secondaire"
            icone={Plus}
            onClick={() => setSaisie({
              supplierId: '', reference: '', dateDebut: aujourdhui(), dateFin: '',
              tauxHoraire: '', coefficient: '1.9', codeAnalytiqueId: null, elements: [],
            })}
          >
            Nouveau contrat
          </Bouton>
        </span>
      </div>

      {err && <Alerte>{err}</Alerte>}

      {(contrats.data ?? []).map((c) => (
        <div key={c.id} className="card" style={{ padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>{c.fournisseur ?? c.agence ?? 'Agence non renseignée'}</strong>
            {c.reference && <span className="code-cell">{c.reference}</span>}
            <span className="muted" style={{ fontSize: 11 }}>
              du {new Date(c.date_debut).toLocaleDateString('fr-FR')}
              {c.date_fin ? ` au ${new Date(c.date_fin).toLocaleDateString('fr-FR')}` : ' (sans terme)'}
            </span>
            <Badge ton="info">{euro(c.taux_facture)} / h facturés</Badge>
            {c.code_analytique && <span className="code-cell">{c.code_analytique}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                className="btn-ghost"
                onClick={() => setSaisie({
                  id: c.id,
                  supplierId: c.supplier_id ?? '',
                  reference: c.reference ?? '',
                  dateDebut: c.date_debut,
                  dateFin: c.date_fin ?? '',
                  tauxHoraire: String(Number(c.taux_horaire)),
                  coefficient: String(Number(c.coefficient)),
                  codeAnalytiqueId: c.code_analytique_id,
                  elements: c.elements.map((e) => ({
                    type: e.type, montant: String(Number(e.montant)), unite: e.unite,
                    codeAnalytiqueId: e.code_analytique_id ?? null,
                  })),
                })}
              >
                Modifier
              </button>
              <button className="btn-ghost" title="Supprimer" onClick={() => supprimer.mutate(c.id)}>
                <Trash2 size={13} />
              </button>
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {euro(c.taux_horaire)} × coefficient {Number(c.coefficient)}
            {c.elements.length > 0 && ' · '}
            {c.elements.map((e) => (
              `${TYPES.find((t) => t.v === e.type)?.l ?? e.type} `
              + `${Number(e.montant)}${e.unite === 'pourcentage' ? ' %' : ' €'}`
            )).join(' · ')}
          </div>
        </div>
      ))}

      {contrats.data && contrats.data.length === 0 && !saisie && (
        <p className="muted" style={{ fontSize: 12 }}>
          Aucun contrat d’agence. Sans lui, les heures de cet intérimaire seront comptées à son
          taux horaire nu — donc bien en dessous de ce que l’agence facture.
        </p>
      )}

      {saisie && (
        <div className="card" style={{ padding: '12px 14px', marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
              <label>Agence d’intérim</label>
              <select
                value={saisie.supplierId}
                onChange={(e) => setSaisie({ ...saisie, supplierId: e.target.value })}
              >
                <option value="">— Choisir dans les fournisseurs —</option>
                {(fournisseurs.data?.rows ?? []).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Référence mission</label>
              <input value={saisie.reference} onChange={(e) => setSaisie({ ...saisie, reference: e.target.value })} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Début</label>
              <input type="date" value={saisie.dateDebut} onChange={(e) => setSaisie({ ...saisie, dateDebut: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Fin</label>
              <input type="date" value={saisie.dateFin} onChange={(e) => setSaisie({ ...saisie, dateFin: e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 120 }}>
              <label>Taux horaire (€)</label>
              <input
                type="number" step="0.01" style={{ textAlign: 'right' }}
                value={saisie.tauxHoraire}
                onChange={(e) => setSaisie({ ...saisie, tauxHoraire: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 110 }}>
              <label>Coefficient</label>
              <input
                type="number" step="0.01" style={{ textAlign: 'right' }}
                value={saisie.coefficient}
                onChange={(e) => setSaisie({ ...saisie, coefficient: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 140 }}>
              <label>Facturé / heure</label>
              {/* Ce que le chantier paiera réellement : c'est ce chiffre qu'on vérifie sur la facture. */}
              <div style={{ padding: '6px 0', fontWeight: 700, textAlign: 'right' }}>
                {euro(facture.toFixed(2))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0, width: 150 }}>
              <label>Code analytique</label>
              <SelectCodeAnalytique
                valeur={saisie.codeAnalytiqueId}
                codes={codes.data ?? []}
                onChange={(id) => setSaisie({ ...saisie, codeAnalytiqueId: id })}
              />
            </div>
          </div>

          <div className="form-section-title" style={{ marginTop: 14 }}>Indemnités facturées</div>
          {saisie.elements.map((el, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 0, width: 190 }}>
                <select
                  value={el.type}
                  onChange={(e) => {
                    const elements = [...saisie.elements];
                    elements[i] = { ...el, type: e.target.value as ElementInterim['type'] };
                    setSaisie({ ...saisie, elements });
                  }}
                >
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, width: 100 }}>
                <input
                  type="number" step="0.01" style={{ textAlign: 'right' }}
                  value={el.montant}
                  onChange={(e) => {
                    const elements = [...saisie.elements];
                    elements[i] = { ...el, montant: e.target.value };
                    setSaisie({ ...saisie, elements });
                  }}
                />
              </div>
              <div className="field" style={{ marginBottom: 0, width: 120 }}>
                <select
                  value={el.unite}
                  onChange={(e) => {
                    const elements = [...saisie.elements];
                    elements[i] = { ...el, unite: e.target.value as ElementInterim['unite'] };
                    setSaisie({ ...saisie, elements });
                  }}
                >
                  {UNITES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, width: 140 }}>
                <SelectCodeAnalytique
                  valeur={el.codeAnalytiqueId ?? null}
                  codes={codes.data ?? []}
                  onChange={(id) => {
                    const elements = [...saisie.elements];
                    elements[i] = { ...el, codeAnalytiqueId: id };
                    setSaisie({ ...saisie, elements });
                  }}
                />
              </div>
              <button
                className="btn-ghost"
                title="Retirer"
                onClick={() => setSaisie({
                  ...saisie, elements: saisie.elements.filter((_, j) => j !== i),
                })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <Bouton
            variante="secondaire"
            icone={Plus}
            onClick={() => setSaisie({
              ...saisie,
              elements: [
                ...saisie.elements,
                { type: 'panier', montant: '', unite: 'jour', codeAnalytiqueId: saisie.codeAnalytiqueId },
              ],
            })}
          >
            Ajouter une indemnité
          </Bouton>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Bouton variante="secondaire" onClick={() => setSaisie(null)}>Annuler</Bouton>
            <Bouton
              chargement={enregistrer.isPending}
              libelleChargement="Enregistrement…"
              disabled={!saisie.dateDebut}
              onClick={() => { setErr(null); enregistrer.mutate(); }}
            >
              Enregistrer le contrat
            </Bouton>
          </div>
        </div>
      )}
    </div>
  );
}
