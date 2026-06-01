import { hashPassword, verifyPassword } from './password.util';

describe('password.util (scrypt)', () => {
  it('vérifie un mot de passe correct', () => {
    const stored = hashPassword('S3cret!');
    expect(verifyPassword('S3cret!', stored)).toBe(true);
  });

  it('rejette un mot de passe incorrect', () => {
    const stored = hashPassword('S3cret!');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produit un sel différent à chaque hachage', () => {
    expect(hashPassword('same')).not.toEqual(hashPassword('same'));
  });

  it('rejette un format stocké invalide', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
