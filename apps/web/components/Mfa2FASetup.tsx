'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';

interface MfaSetup { secret: string; otpauthUri: string; qrDataUri: string }

/**
 * Configuration de la double authentification (2FA) — réutilisable.
 * Enchaîne : génération du secret + QR → saisie d'un code de vérification → affichage des codes
 * de secours (une seule fois) → `onDone`.
 *
 * `onCancel` absent = configuration OBLIGATOIRE (pas de bouton d'abandon) : c'est le cas à
 * l'inscription, où la 2FA est exigée avant d'entrer dans l'application.
 */
export function Mfa2FASetup({ token, onDone, onCancel }: {
  token: string | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mandatory = !onCancel;

  const start = useMutation({
    mutationFn: () => apiFetch<MfaSetup>('/auth/mfa/setup', { method: 'POST', token }),
    onSuccess: (d) => { setSetup(d); setErr(null); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const confirm = useMutation({
    mutationFn: () => apiFetch<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', token, body: { code } }),
    onSuccess: (d) => { setRecovery(d.recoveryCodes); setErr(null); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Code invalide.'),
  });

  // Obligatoire : on démarre la génération dès l'affichage (pas de « Activer » à cliquer).
  const startMutate = start.mutate;
  useEffect(() => {
    if (mandatory && !setup && !recovery) startMutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandatory]);

  if (recovery) {
    return (
      <div>
        <div className="badge success" style={{ marginBottom: 10 }}>✓ Double authentification activée</div>
        <p style={{ fontSize: 12, margin: '0 0 8px' }}>
          Conservez ces <strong>codes de secours</strong> en lieu sûr : ils permettent de vous
          reconnecter si vous perdez votre téléphone. Chacun ne sert qu’une fois.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '4px 24px', fontFamily: 'monospace', fontSize: 13, margin: '8px 0 14px' }}>
          {recovery.map((c) => <span key={c}>{c}</span>)}
        </div>
        <button className="btn" onClick={onDone}>J’ai noté mes codes, continuer</button>
      </div>
    );
  }

  if (!setup) {
    return start.isPending || mandatory
      ? <p className="muted">Préparation…</p>
      : <button className="btn" onClick={() => start.mutate()} disabled={start.isPending}>Configurer la double authentification</button>;
  }

  return (
    <div>
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <p style={{ fontSize: 12, margin: '0 0 8px' }}>
        <strong>1.</strong> Scannez ce QR code avec une application d’authentification (Google
        Authenticator, Authy, Microsoft Authenticator…) :
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qrDataUri} alt="QR code de configuration" width={200} height={200}
        style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
      <p className="muted" style={{ fontSize: 11, margin: '8px 0' }}>
        Ou saisissez la clé manuellement : <code style={{ userSelect: 'all' }}>{setup.secret}</code>
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>2. Entrez le code affiché par l’application</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoFocus />
        </div>
        <button className="btn" disabled={!code || confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? '…' : 'Vérifier et activer'}
        </button>
        {onCancel && <button className="link" type="button" onClick={onCancel}>Annuler</button>}
      </div>
    </div>
  );
}
