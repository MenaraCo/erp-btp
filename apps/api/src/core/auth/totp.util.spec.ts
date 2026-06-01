import { generateTotpSecret, totp, verifyTotp } from './totp.util';

// RFC 6238 test secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp.util (RFC 6238)', () => {
  it('reproduit le vecteur de test RFC 6238 à T=59s', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
  });

  it('vérifie un code valide pour l’instant courant', () => {
    const secret = generateTotpSecret();
    const code = totp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rejette un code invalide', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('tolère une dérive d’horloge d’un pas (±30s)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const previousStepCode = totp(secret, now - 30_000);
    expect(verifyTotp(secret, previousStepCode, now, 1)).toBe(true);
  });
});
