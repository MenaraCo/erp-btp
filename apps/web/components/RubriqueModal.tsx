'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modale } from './Modale';
import { Alerte, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';

export interface Rubrique {
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
  code_analytique_id: string | null;
  code_analytique?: string | null;
  nature: string;
}

export const TYPES_RUBRIQUE: Array<{ v: Rubrique['type']; l: string; aide: string }> = [
  { v: 'panier', l: 'Panier', aide: 'Posé automatiquement : un par jour travaillé.' },
  { v: 'deplacement', l: 'Déplacement', aide: 'Posé automatiquement : un par jour travaillé.' },
  { v: 'heures_sup', l: 'Heures supplémentaires', aide: 'Calculé par semaine, sur la tranche indiquée.' },
  { v: 'prime', l: 'Prime', aide: 'Saisie à la main sur le relevé du mois.' },
  { v: 'autre', l: 'Autre', aide: 'Saisie à la main sur le relevé du mois.' },
];
export const UNITES_RUBRIQUE: Array<{ v: Rubrique['unite']; l: string }> = [
  { v: 'jour', l: 'Jour' }, { v: 'heure', l: 'Heure' }, { v: 'forfait', l: 'Forfait' },
];
export const NATURES_RUBRIQUE: Array<{ v: string; l: string }> = [
  { v: 'labor', l: 'Main d’œuvre' },
  { v: 'site_overhead', l: 'Frais de chantier' },
  { v: 'equipment', l: 'Matériel' },
  { v: 'material', l: 'Matériaux' },
  { v: 'subcontract', l: 'Sous-traitance' },
];

interface Champs {
  code: string;
  label: string;
  type: Rubrique['type'];
  unite: Rubrique['unite'];
  montantUnitaire: string;
  seuilDebut: string;
  seuilFin: string;
  /** En pourcentage à l'écran (25), en fraction en base (0,25) — personne ne saisit « 0,25 ». */
  majoration: string;
  codeAnalytiqueId: string | null;
  nature: string;
  actif: boolean;
}

const VIDE: Champs = {
  code: '', label: '', type: 'panier', unite: 'jour', montantUnitaire: '',
  seuilDebut: '35', seuilFin: '43', majoration: '25', codeAnalytiqueId: null,
  nature: 'labor', actif: true,
};

function depuis(r: Rubrique): Champs {
  return {
    code: r.code,
    label: r.label,
    type: r.type,
    unite: r.unite,
    montantUnitaire: String(Number(r.montant_unitaire ?? 0)),
    seuilDebut: r.seuil_debut != null ? String(Number(r.seuil_debut)) : '35',
    seuilFin: r.seuil_fin != null ? String(Number(r.seuil_fin)) : '',
    majoration: r.majoration != null ? String(Math.round(Number(r.majoration) * 100)) : '',
    codeAnalytiqueId: r.code_analytique_id,
    nature: r.nature ?? 'labor',
    actif: r.actif,
  };
}

/**
 * Fiche d'une rubrique de paye — création ET modification.
 *
 * Un montant de panier change chaque année, un taux de majoration se corrige : une rubrique qui ne
 * se modifie plus obligerait à en créer une seconde, et les relevés passés perdraient le lien avec
 * celle qu'ils portent. La même fenêtre s'ouvre depuis le paramétrage et depuis le relevé d'un
 * salarié, pour corriger là où l'erreur se voit.
 */
export function RubriqueModal({
  rubrique, onClose,
}: {
  /** Rubrique à modifier ; absente, la fenêtre en crée une. */
  rubrique: Rubrique | null;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Champs>(() => (rubrique ? depuis(rubrique) : { ...VIDE }));

  const codes = useQuery({
    queryKey: ['params-codes'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const set = (patch: Partial<Champs>) => setF({ ...f, ...patch });
  const heuresSup = f.type === 'heures_sup';

  const enregistrer = useMutation({
    mutationFn: () => apiFetch(
      rubrique ? `/paye/rubriques/${rubrique.id}` : '/paye/rubriques',
      {
        method: rubrique ? 'PATCH' : 'POST',
        token,
        body: {
          code: f.code,
          label: f.label,
          type: f.type,
          unite: f.unite,
          montantUnitaire: heuresSup ? '0' : (f.montantUnitaire || '0'),
          // Tranche et majoration n'ont de sens que pour des heures supplémentaires : ailleurs on
          // les efface, sinon une rubrique changée de type garderait une règle fantôme.
          seuilDebut: heuresSup ? (f.seuilDebut || null) : null,
          seuilFin: heuresSup && f.seuilFin ? f.seuilFin : null,
          majoration: heuresSup && f.majoration ? String(Number(f.majoration) / 100) : null,
          codeAnalytiqueId: f.codeAnalytiqueId,
          nature: f.nature,
          actif: f.actif,
        },
      },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paye-rubriques'] });
      qc.invalidateQueries({ queryKey: ['paye-releve'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  return (
    <Modale
      titre={rubrique ? `Rubrique ${rubrique.code}` : 'Nouvelle rubrique de paye'}
      sousTitre={TYPES_RUBRIQUE.find((t) => t.v === f.type)?.aide}
      largeur="m"
      onClose={onClose}
      actions={(
        <Bouton
          chargement={enregistrer.isPending}
          libelleChargement="Enregistrement…"
          disabled={!f.code.trim() || !f.label.trim()}
          onClick={() => { setErr(null); enregistrer.mutate(); }}
        >
          Enregistrer
        </Bouton>
      )}
    >
      {err && <Alerte>{err}</Alerte>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, width: 110 }}>
          <label>Code</label>
          <input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="PAN" />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label>Libellé</label>
          <input value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="Panier repas" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <div className="field" style={{ marginBottom: 0, width: 190 }}>
          <label>Type</label>
          <select value={f.type} onChange={(e) => set({ type: e.target.value as Rubrique['type'] })}>
            {TYPES_RUBRIQUE.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, width: 110 }}>
          <label>Unité</label>
          <select value={f.unite} onChange={(e) => set({ unite: e.target.value as Rubrique['unite'] })}>
            {UNITES_RUBRIQUE.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
          </select>
        </div>
        {!heuresSup && (
          <div className="field" style={{ marginBottom: 0, width: 140 }}>
            <label>Montant unitaire (€)</label>
            <input
              type="number" step="0.01" style={{ textAlign: 'right' }}
              value={f.montantUnitaire}
              onChange={(e) => set({ montantUnitaire: e.target.value })}
            />
          </div>
        )}
      </div>

      {heuresSup && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label>De (h / semaine)</label>
            <input type="number" step="0.5" style={{ textAlign: 'right' }}
              value={f.seuilDebut} onChange={(e) => set({ seuilDebut: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label>À (h / semaine)</label>
            <input type="number" step="0.5" style={{ textAlign: 'right' }} placeholder="sans limite"
              value={f.seuilFin} onChange={(e) => set({ seuilFin: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label>Majoration (%)</label>
            <input type="number" step="1" style={{ textAlign: 'right' }}
              value={f.majoration} onChange={(e) => set({ majoration: e.target.value })} />
          </div>
        </div>
      )}

      <div className="form-section-title" style={{ marginTop: 14 }}>Imputation</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, width: 170 }}>
          <label>Code analytique</label>
          <SelectCodeAnalytique
            valeur={f.codeAnalytiqueId}
            codes={codes.data ?? []}
            onChange={(id) => set({ codeAnalytiqueId: id })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 170 }}>
          <label>Nature analytique</label>
          <select value={f.nature} onChange={(e) => set({ nature: e.target.value })}>
            {NATURES_RUBRIQUE.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
          </select>
        </div>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={f.actif} onChange={(e) => set({ actif: e.target.checked })} />
          Active
        </label>
      </div>
      <p className="muted" style={{ fontSize: 11, marginBottom: 0, marginTop: 8 }}>
        Sans code analytique, la dépense n’entre dans aucun tableau de bord — et le relevé refusera
        d’être validé.
      </p>
    </Modale>
  );
}
