'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';

interface Company { slug: string; name: string }

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState(''); // slug choisi dans la liste
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Double authentification : une fois le mot de passe validé, on réclame le code.
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');

  const lastLookup = useRef('');

  // Dès qu'un e-mail valide est saisi, on interroge le serveur pour lister SES sociétés. L'utilisateur
  // choisit ensuite dans la liste au lieu de retaper un nom/slug (source du bug de reconnexion).
  useEffect(() => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setCompanies(null);
      setTenant('');
      return;
    }
    if (value === lastLookup.current) return;
    const handle = setTimeout(async () => {
      lastLookup.current = value;
      setLookupBusy(true);
      try {
        const res = await apiFetch<{ companies: Company[] }>('/auth/companies', {
          method: 'POST',
          body: { email: value },
        });
        setCompanies(res.companies);
        // Une seule société : on la sélectionne d'office (pas de choix à faire).
        setTenant(res.companies.length === 1 ? res.companies[0].slug : '');
      } catch {
        setCompanies([]);
        setTenant('');
      } finally {
        setLookupBusy(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenant) {
      setError(
        companies && companies.length === 0
          ? 'Aucune société n’est associée à cet e-mail.'
          : 'Sélectionnez votre société.',
      );
      return;
    }
    setLoading(true);
    try {
      const res = await login(tenant, email.trim(), password, mfaStep ? code : undefined);
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

  const multiple = (companies?.length ?? 0) > 1;

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>ERP BTP</h1>
        <p className="muted" style={{ marginTop: 0 }}>Connexion à votre espace</p>
        {error && <div className="error">{error}</div>}
        {!mfaStep ? (
          <>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" type="email" autoFocus autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@societe.fr" />
            </div>
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <input id="password" type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tenant">Entreprise</label>
              {multiple ? (
                <select id="tenant" value={tenant} onChange={(e) => setTenant(e.target.value)}>
                  <option value="">— Choisissez votre société —</option>
                  {companies!.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <input id="tenant" disabled readOnly
                  value={
                    lookupBusy
                      ? 'Recherche…'
                      : companies === null
                        ? 'Saisissez d’abord votre e-mail'
                        : companies.length === 1
                          ? companies[0].name
                          : 'Aucune société pour cet e-mail'
                  }
                  style={{ color: 'var(--muted)' }} />
              )}
              {companies && companies.length === 0 && (
                <span className="muted" style={{ fontSize: 11 }}>
                  Vérifiez l’e-mail, ou <Link href="/inscription" className="link">créez un compte</Link>.
                </span>
              )}
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
