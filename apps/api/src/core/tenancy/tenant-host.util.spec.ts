import { extractTenantSlugFromHost } from './tenant-host.util';

describe('extractTenantSlugFromHost', () => {
  const base = 'localhost';

  it('extrait le slug d’un sous-domaine simple', () => {
    expect(extractTenantSlugFromHost('acme.localhost', base)).toBe('acme');
  });

  it('ignore le port éventuel', () => {
    expect(extractTenantSlugFromHost('acme.localhost:3001', base)).toBe('acme');
  });

  it('retourne le premier label pour un sous-domaine multi-niveaux', () => {
    expect(extractTenantSlugFromHost('acme.eu.localhost', base)).toBe('acme');
  });

  it('retourne null quand le host est le domaine de base nu', () => {
    expect(extractTenantSlugFromHost('localhost', base)).toBeNull();
  });

  it('retourne null quand le host ne correspond pas au domaine de base', () => {
    expect(extractTenantSlugFromHost('127.0.0.1', base)).toBeNull();
    expect(extractTenantSlugFromHost('example.com', base)).toBeNull();
  });

  it('retourne null pour un host vide', () => {
    expect(extractTenantSlugFromHost('', base)).toBeNull();
  });
});
