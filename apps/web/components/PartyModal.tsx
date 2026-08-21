'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modale } from './Modale';
import { Alerte, Bouton } from './ui';
import { CompanySearch } from './CompanySearch';

export interface Party {
  id: string;
  code: string;
  name: string;
  vat_number: string | null;
  email: string | null;
  phone: string | null;
  address: AdresseParty | null;
  statut?: string;
}

/** L'adresse est stockée en JSON : une fiche client n'a pas à faire migrer le schéma. */
export interface AdresseParty {
  siret?: string | null;
  siren?: string | null;
  formeJuridique?: string | null;
  naf?: string | null;
  rue?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  pays?: string | null;
  contactNom?: string | null;
  contactFonction?: string | null;
  contactTelephone?: string | null;
  contactEmail?: string | null;
  conditionsPaiement?: string | null;
  notes?: string | null;
}

type Champs = {
  name: string;
  vatNumber: string;
  email: string;
  phone: string;
} & { [K in keyof AdresseParty]-?: string };

const VIDE: Champs = {
  name: '', vatNumber: '', email: '', phone: '',
  siret: '', siren: '', formeJuridique: '', naf: '', rue: '', codePostal: '', ville: '', pays: '',
  contactNom: '', contactFonction: '', contactTelephone: '', contactEmail: '',
  conditionsPaiement: '', notes: '',
};

function depuis(p: Party): Champs {
  const a = p.address ?? {};
  const t = (v: string | null | undefined) => v ?? '';
  return {
    name: p.name,
    vatNumber: t(p.vat_number),
    email: t(p.email),
    phone: t(p.phone),
    siret: t(a.siret), siren: t(a.siren), formeJuridique: t(a.formeJuridique), naf: t(a.naf),
    rue: t(a.rue), codePostal: t(a.codePostal), ville: t(a.ville), pays: t(a.pays),
    contactNom: t(a.contactNom), contactFonction: t(a.contactFonction),
    contactTelephone: t(a.contactTelephone), contactEmail: t(a.contactEmail),
    conditionsPaiement: t(a.conditionsPaiement), notes: t(a.notes),
  };
}

/**
 * Fiche client ou fournisseur — création et modification, dans la même fenêtre.
 *
 * Une fiche tenue sur quatre champs oblige à chercher ailleurs ce qu'il faut pour établir un
 * devis ou un bon de commande : adresse de facturation, SIRET, interlocuteur, conditions de
 * paiement. Tout est ici, et la recherche à l'annuaire officiel remplit l'identité légale d'un
 * clic — on ne retape pas un SIRET à quatorze chiffres.
 *
 * Le CODE n'est jamais saisi : la numérotation de la société l'attribue, et le champ ne s'affiche
 * qu'en modification, en lecture seule.
 */
export function PartyModal({
  resource, singular, party, onClose,
}: {
  resource: 'clients' | 'suppliers';
  singular: string;
  /** Fiche à modifier ; absente, la fenêtre en crée une. */
  party: Party | null;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Champs>(() => (party ? depuis(party) : { ...VIDE }));

  const set = (patch: Partial<Champs>) => setF({ ...f, ...patch });
  const ou = (v: string) => (v.trim() === '' ? null : v.trim());

  const enregistrer = useMutation({
    mutationFn: () => apiFetch(
      party ? `/${resource}/${party.id}` : `/${resource}`,
      {
        method: party ? 'PATCH' : 'POST',
        token,
        body: {
          // Pas de `code` à la création : la numérotation société s'en charge. L'envoyer vide
          // laissait croire à un champ obligatoire.
          name: f.name.trim(),
          vatNumber: ou(f.vatNumber),
          email: ou(f.email),
          phone: ou(f.phone),
          address: {
            siret: ou(f.siret), siren: ou(f.siren), formeJuridique: ou(f.formeJuridique),
            naf: ou(f.naf), rue: ou(f.rue), codePostal: ou(f.codePostal), ville: ou(f.ville),
            pays: ou(f.pays), contactNom: ou(f.contactNom), contactFonction: ou(f.contactFonction),
            contactTelephone: ou(f.contactTelephone), contactEmail: ou(f.contactEmail),
            conditionsPaiement: ou(f.conditionsPaiement), notes: ou(f.notes),
          },
        },
      },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  const champ = (libelle: string, cle: keyof Champs, largeur?: number, type = 'text') => (
    <div className="field" style={{ marginBottom: 0, flex: largeur ? undefined : 1, width: largeur }}>
      <label>{libelle}</label>
      <input
        type={type}
        value={f[cle]}
        onChange={(e) => set({ [cle]: e.target.value } as Partial<Champs>)}
      />
    </div>
  );

  return (
    <Modale
      titre={party ? `${party.code} — ${party.name}` : `Nouveau ${singular}`}
      sousTitre={party ? undefined : 'Le code est attribué automatiquement à l’enregistrement.'}
      largeur="l"
      onClose={onClose}
      actions={(
        <Bouton
          chargement={enregistrer.isPending}
          libelleChargement="Enregistrement…"
          disabled={!f.name.trim()}
          onClick={() => { setErr(null); enregistrer.mutate(); }}
        >
          Enregistrer
        </Bouton>
      )}
    >
      {err && <Alerte>{err}</Alerte>}

      <div className="field">
        <CompanySearch
          label={`Rechercher le ${singular} (annuaire officiel)`}
          onSelect={(c) => setF((prev) => ({
            ...prev,
            name: c.name,
            vatNumber: c.vatIntra ?? prev.vatNumber,
            siren: c.siren ?? prev.siren,
            siret: c.siret ?? prev.siret,
            formeJuridique: c.legalForm ?? prev.formeJuridique,
            naf: c.naf ?? prev.naf,
            rue: c.address ?? prev.rue,
            codePostal: c.postalCode ?? prev.codePostal,
            ville: c.city ?? prev.ville,
          }))}
        />
      </div>

      <div className="form-section-title">Identité</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Raison sociale *', 'name')}
        {champ('Forme juridique', 'formeJuridique', 140)}
        {party && (
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label>Code</label>
            <input value={party.code} disabled title="Attribué automatiquement" />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {champ('SIRET', 'siret', 170)}
        {champ('SIREN', 'siren', 140)}
        {champ('Code NAF', 'naf', 110)}
        {champ('N° TVA intracom.', 'vatNumber', 170)}
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Adresse</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Rue', 'rue')}
        {champ('Code postal', 'codePostal', 110)}
        {champ('Ville', 'ville', 180)}
        {champ('Pays', 'pays', 130)}
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Contact</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {champ('Nom du contact', 'contactNom')}
        {champ('Fonction', 'contactFonction', 160)}
        {champ('Téléphone', 'contactTelephone', 150, 'tel')}
        {champ('E-mail', 'contactEmail', 200, 'email')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {champ('Téléphone (standard)', 'phone', 170, 'tel')}
        {champ('E-mail (standard)', 'email', 220, 'email')}
        {champ('Conditions de paiement', 'conditionsPaiement')}
      </div>

      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
        <label>Notes</label>
        <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Modale>
  );
}
