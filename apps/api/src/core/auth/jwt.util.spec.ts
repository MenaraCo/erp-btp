import { signJwt, verifyJwt } from './jwt.util';

const SECRET = 'unit-test-secret';

describe('jwt.util (HS256)', () => {
  it('signe et vérifie un token (aller-retour)', () => {
    const token = signJwt({ sub: 'user-1', tid: 'tenant-1', email: 'a@b.c' }, SECRET, 3600);
    const payload = verifyJwt(token, SECRET);
    expect(payload?.sub).toBe('user-1');
    expect(payload?.tid).toBe('tenant-1');
  });

  it('rejette un token expiré', () => {
    const token = signJwt({ sub: 'u', tid: 't' }, SECRET, -1);
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  it('rejette une signature falsifiée', () => {
    const token = signJwt({ sub: 'u', tid: 't' }, SECRET, 3600);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyJwt(tampered, SECRET)).toBeNull();
  });

  it('rejette un token signé avec un autre secret', () => {
    const token = signJwt({ sub: 'u', tid: 't' }, SECRET, 3600);
    expect(verifyJwt(token, 'other-secret')).toBeNull();
  });
});
