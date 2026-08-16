'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modale } from '@/components/Modale';

interface Resultat {
  statut: 'sent' | 'pending' | 'failed';
  message: string;
  destinataires: string;
  sujet: string;
}

/**
 * Envoi du bon de commande au fournisseur, depuis l'application.
 *
 * Le geste réel qu'on remplace : enregistrer le PDF, ouvrir sa messagerie, retrouver le fichier,
 * écrire l'objet, joindre, envoyer. Ici tout est pré-rempli — adresse du fournisseur, objet
 * reprenant le numéro et le chantier, message type — et la pièce jointe est constituée seule.
 *
 * Le message se relit et se corrige avant de partir : c'est un courrier commercial, pas un
 * formulaire technique.
 */
export function EnvoiCommandeModal({
  orderId,
  code,
  chantier,
  emailFournisseur,
  onClose,
  onEnvoye,
}: {
  orderId: string;
  code: string;
  chantier: string | null;
  emailFournisseur: string | null;
  onClose: () => void;
  onEnvoye: (message: string) => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [destinataires, setDestinataires] = useState(emailFournisseur ?? '');
  const [copies, setCopies] = useState('');
  const [sujet, setSujet] = useState(`Bon de commande ${code}${chantier ? ` — chantier ${chantier}` : ''}`);
  const [message, setMessage] = useState([
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint notre bon de commande ${code}${chantier ? ` pour le chantier « ${chantier} »` : ''}.`,
    '',
    'Merci de nous confirmer sa bonne réception ainsi que la date de livraison prévue.',
    '',
    'Cordialement,',
  ].join('\n'));
  const [err, setErr] = useState<string | null>(null);

  const envoyer = useMutation({
    mutationFn: () => apiFetch<Resultat>(`/purchase-orders/${orderId}/envoyer`, {
      method: 'POST', token,
      body: { destinataires, copies, sujet, message },
    }),
    onSuccess: (r) => {
      for (const key of ['commande', 'commande-journal', 'commande-emails', 'achats-commandes']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onEnvoye(r.message);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Envoi impossible.'),
  });

  return (
    <Modale
      titre="Envoyer le bon de commande"
      sousTitre={`${code}.pdf sera joint automatiquement — aucun enregistrement ni pièce jointe à préparer.`}
      largeur="l"
      onClose={onClose}
      actions={(
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button
            className="btn"
            disabled={!destinataires.trim() || envoyer.isPending}
            onClick={() => { setErr(null); envoyer.mutate(); }}
          >
            {envoyer.isPending ? 'Envoi…' : 'Envoyer au fournisseur'}
          </button>
        </>
      )}
    >
      <>
        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="field">
          <label>Destinataire(s) *</label>
          <input
            value={destinataires}
            placeholder="commandes@fournisseur.fr"
            onChange={(e) => setDestinataires(e.target.value)}
          />
          {!emailFournisseur && (
            <span className="muted" style={{ fontSize: 11 }}>
              Ce fournisseur n’a pas d’adresse enregistrée : saisissez-la ici, ou complétez sa fiche
              au référentiel pour la retrouver la prochaine fois.
            </span>
          )}
        </div>

        <div className="field">
          <label>En copie</label>
          <input
            value={copies}
            placeholder="conducteur@votre-societe.fr"
            onChange={(e) => setCopies(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Objet</label>
          <input value={sujet} onChange={(e) => setSujet(e.target.value)} />
        </div>

        <div className="field">
          <label>Message</label>
          <textarea
            value={message}
            rows={8}
            onChange={(e) => setMessage(e.target.value)}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
          />
        </div>

        <div className="card" style={{ padding: '8px 12px', fontSize: 12 }}>
          <span className="muted">Pièce jointe : </span>
          <strong>{code}.pdf</strong>
        </div>
      </>
    </Modale>
  );
}
