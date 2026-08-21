'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modale } from './Modale';
import { Alerte, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';

interface Fournisseur { id: string; name: string }

export interface Materiel {
  id: string;
  code: string;
  label: string;
  type: 'engin' | 'vehicule' | 'outillage' | 'autre';
  propriete: 'parc' | 'location';
  supplier_id: string | null;
  fournisseur: string | null;
  marque: string | null;
  modele: string | null;
  immatriculation: string | null;
  numero_serie: string | null;
  annee: number | null;
  cout_unitaire: string;
  unite_cout: 'heure' | 'jour';
  code_analytique_id: string | null;
  code_analytique: string | null;
  date_achat: string | null;
  valeur_achat: string | null;
  date_prochaine_revision: string | null;
  date_controle_technique: string | null;
  date_assurance: string | null;
  actif: boolean;
  commentaire: string | null;
  chantier_actuel: string | null;
  cout_amenee: string;
  cout_repli: string;
}

export const TYPES_MATERIEL: Array<{ v: Materiel['type']; l: string }> = [
  { v: 'engin', l: 'Engin' },
  { v: 'vehicule', l: 'Véhicule' },
  { v: 'outillage', l: 'Outillage' },
  { v: 'autre', l: 'Autre' },
];

/** Une échéance dépassée, ou qui tombe dans le mois : l'engin ne doit pas partir sans qu'on le sache. */
export function echeanceProche(date: string | null, jours = 30): boolean {
  if (!date) return false;
  const limite = new Date();
  limite.setDate(limite.getDate() + jours);
  return new Date(date) <= limite;
}

type Champs = {
  label: string;
  type: Materiel['type'];
  propriete: Materiel['propriete'];
  supplierId: string;
  marque: string;
  modele: string;
  immatriculation: string;
  numeroSerie: string;
  annee: string;
  coutUnitaire: string;
  uniteCout: Materiel['unite_cout'];
  codeAnalytiqueId: string | null;
  dateAchat: string;
  valeurAchat: string;
  dateProchaineRevision: string;
  dateControleTechnique: string;
  dateAssurance: string;
  actif: boolean;
  commentaire: string;
  coutAmenee: string;
  coutRepli: string;
};

const VIDE: Champs = {
  label: '', type: 'engin', propriete: 'parc', supplierId: '', marque: '', modele: '',
  immatriculation: '', numeroSerie: '', annee: '', coutUnitaire: '', uniteCout: 'jour',
  codeAnalytiqueId: null, dateAchat: '', valeurAchat: '', dateProchaineRevision: '',
  dateControleTechnique: '', dateAssurance: '', actif: true, commentaire: '',
  coutAmenee: '', coutRepli: '',
};

function depuis(m: Materiel): Champs {
  return {
    label: m.label,
    type: m.type,
    propriete: m.propriete,
    supplierId: m.supplier_id ?? '',
    marque: m.marque ?? '',
    modele: m.modele ?? '',
    immatriculation: m.immatriculation ?? '',
    numeroSerie: m.numero_serie ?? '',
    annee: m.annee != null ? String(m.annee) : '',
    coutUnitaire: String(Number(m.cout_unitaire ?? 0)),
    uniteCout: m.unite_cout,
    codeAnalytiqueId: m.code_analytique_id,
    dateAchat: m.date_achat ?? '',
    valeurAchat: m.valeur_achat != null ? String(Number(m.valeur_achat)) : '',
    dateProchaineRevision: m.date_prochaine_revision ?? '',
    dateControleTechnique: m.date_controle_technique ?? '',
    dateAssurance: m.date_assurance ?? '',
    actif: m.actif,
    commentaire: m.commentaire ?? '',
    coutAmenee: String(Number(m.cout_amenee ?? 0)),
    coutRepli: String(Number(m.cout_repli ?? 0)),
  };
}

/**
 * Fiche d'un matériel — création et modification.
 *
 * Le coût qui compte n'est pas le prix d'achat mais le COÛT D'UTILISATION : c'est lui qu'on
 * impute au chantier, à l'heure ou à la journée selon l'engin. Le prix d'achat n'est là que pour
 * mémoire, et l'entretien pour éviter qu'une machine parte avec un contrôle périmé.
 */
export function MaterielModal({
  materiel, onClose,
}: {
  materiel: Materiel | null;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Champs>(() => (materiel ? depuis(materiel) : { ...VIDE }));

  const fournisseurs = useQuery({
    queryKey: ['suppliers-filtre'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<{ rows: Fournisseur[] }>('/suppliers?sort=name&pageSize=100', { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const set = (patch: Partial<Champs>) => setF({ ...f, ...patch });

  const enregistrer = useMutation({
    mutationFn: () => apiFetch(
      materiel ? `/materiel/${materiel.id}` : '/materiel',
      {
        method: materiel ? 'PATCH' : 'POST',
        token,
        body: {
          label: f.label,
          type: f.type,
          propriete: f.propriete,
          supplierId: f.supplierId || null,
          marque: f.marque, modele: f.modele,
          immatriculation: f.immatriculation, numeroSerie: f.numeroSerie,
          annee: f.annee ? Number(f.annee) : null,
          coutUnitaire: f.coutUnitaire || '0',
          uniteCout: f.uniteCout,
          codeAnalytiqueId: f.codeAnalytiqueId,
          dateAchat: f.dateAchat || null,
          valeurAchat: f.valeurAchat || null,
          dateProchaineRevision: f.dateProchaineRevision || null,
          dateControleTechnique: f.dateControleTechnique || null,
          dateAssurance: f.dateAssurance || null,
          actif: f.actif,
          commentaire: f.commentaire,
          coutAmenee: f.coutAmenee || '0',
          coutRepli: f.coutRepli || '0',
        },
      },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['materiel'] });
      qc.invalidateQueries({ queryKey: ['materiel-echeances'] });
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const champ = (libelle: string, cle: keyof Champs, type = 'text', largeur?: number) => (
    <div className="field" style={{ marginBottom: 0, flex: largeur ? undefined : 1, width: largeur }}>
      <label>{libelle}</label>
      <input
        type={type}
        value={String(f[cle] ?? '')}
        onChange={(e) => set({ [cle]: e.target.value } as Partial<Champs>)}
      />
    </div>
  );

  return (
    <Modale
      titre={materiel ? `${materiel.code} — ${materiel.label}` : 'Nouveau matériel'}
      sousTitre={materiel?.chantier_actuel ? `Sur le chantier ${materiel.chantier_actuel}` : undefined}
      largeur="l"
      onClose={onClose}
      actions={(
        <Bouton
          chargement={enregistrer.isPending}
          libelleChargement="Enregistrement…"
          disabled={!f.label.trim() || !f.codeAnalytiqueId}
          onClick={() => { setErr(null); enregistrer.mutate(); }}
        >
          Enregistrer
        </Bouton>
      )}
    >
      {err && <Alerte>{err}</Alerte>}

      <div className="form-section-title">Identification</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Désignation', 'label')}
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Type</label>
          <select value={f.type} onChange={(e) => set({ type: e.target.value as Materiel['type'] })}>
            {TYPES_MATERIEL.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Propriété</label>
          <select
            value={f.propriete}
            onChange={(e) => set({ propriete: e.target.value as Materiel['propriete'] })}
          >
            <option value="parc">Parc</option>
            <option value="location">Location</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {champ('Marque', 'marque', 'text', 150)}
        {champ('Modèle', 'modele', 'text', 150)}
        {champ('Immatriculation', 'immatriculation', 'text', 150)}
        {champ('N° de série', 'numeroSerie', 'text', 150)}
        {champ('Année', 'annee', 'number', 90)}
      </div>
      {f.propriete === 'location' && (
        <div className="field" style={{ marginTop: 10, marginBottom: 0, maxWidth: 300 }}>
          <label>Loueur</label>
          <select value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
            <option value="">— Choisir dans les fournisseurs —</option>
            {(fournisseurs.data?.rows ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-section-title" style={{ marginTop: 14 }}>Coût imputé au chantier</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Coût d’utilisation</label>
          <input
            type="number" step="0.01" style={{ textAlign: 'right' }}
            value={f.coutUnitaire}
            onChange={(e) => set({ coutUnitaire: e.target.value })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 110 }}>
          <label>Par</label>
          <select
            value={f.uniteCout}
            onChange={(e) => set({ uniteCout: e.target.value as Materiel['unite_cout'] })}
          >
            <option value="jour">Journée</option>
            <option value="heure">Heure</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, width: 160 }}>
          <label>Code analytique *</label>
          <SelectCodeAnalytique
            valeur={f.codeAnalytiqueId}
            codes={codes.data ?? []}
            onChange={(id) => set({ codeAnalytiqueId: id })}
            obligatoire
          />
        </div>
        <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={f.actif} onChange={(e) => set({ actif: e.target.checked })} />
          Actif
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <div className="field" style={{ marginBottom: 0, width: 150 }}>
          <label>Amenée (€)</label>
          <input
            type="number" step="0.01" style={{ textAlign: 'right' }}
            value={f.coutAmenee}
            onChange={(e) => set({ coutAmenee: e.target.value })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 150 }}>
          <label>Repli (€)</label>
          <input
            type="number" step="0.01" style={{ textAlign: 'right' }}
            value={f.coutRepli}
            onChange={(e) => set({ coutRepli: e.target.value })}
          />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
        C’est ce coût — et non le prix d’achat — qui sera compté sur le chantier à chaque journée
        d’utilisation relevée. L’amenée et le repli sont des forfaits de transport proposés à
        chaque mission, corrigeables sur la réservation. Tout matériel relève du déboursé{' '}
        <strong>Matériel</strong>, et son <strong>code analytique est obligatoire</strong> : sans
        lui, ses journées n’apparaîtraient dans aucun tableau de bord.
      </p>

      <div className="form-section-title" style={{ marginTop: 14 }}>Acquisition et entretien</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Date d’achat', 'dateAchat', 'date', 150)}
        {champ('Valeur d’achat (€)', 'valeurAchat', 'number', 140)}
        {champ('Prochaine révision', 'dateProchaineRevision', 'date', 160)}
        {champ('Contrôle technique', 'dateControleTechnique', 'date', 160)}
        {champ('Assurance', 'dateAssurance', 'date', 150)}
      </div>
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>Commentaire</label>
        <textarea rows={2} value={f.commentaire} onChange={(e) => set({ commentaire: e.target.value })} />
      </div>
    </Modale>
  );
}
