'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'demo';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [tenant, setTenant] = useState(DEFAULT_TENANT);
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Double authentification : une fois le mot de passe validé, on réclame le code.
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(tenant, email, password, mfaStep ? code : undefined);
      if (res.mfaRequired) {
        setMfaStep(true);
        return;
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>ERP BTP</h1>
        <p className="muted" style={{ marginTop: 0 }}>Connexion à votre espace</p>
        {error && <div className="error">{error}</div>}
        {!mfaStep ? (
          <>
            <div className="field">
              <label htmlFor="tenant">Entreprise</label>
              <input id="tenant" value={tenant} onChange={(e) => setTenant(e.target.value)}
                placeholder="Nom de votre société" />
            </div>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="code">Code de vérification</label>
            <input id="code" value={code} autoFocus inputMode="numeric" autoComplete="one-time-code"
              placeholder="123456" onChange={(e) => setCode(e.target.value)} />
            <span className="muted" style={{ fontSize: 11 }}>
              Code de votre application d’authentification (ou un code de secours).
            </span>
          </div>
        )}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Connexion…' : mfaStep ? 'Valider le code' : 'Se connecter'}
        </button>
        <p className="muted" style={{ textAlign: 'center', marginTop: 16, marginBottom: 0, fontSize: 12 }}>
          Pas encore de compte ? <Link href="/inscription" className="link">Créer un compte</Link>
        </p>
      </form>
    </div>
  );
}
