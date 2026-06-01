import { loadAppConfig } from './env.config';

describe('loadAppConfig — flag trial_requires_payment_method', () => {
  const original = process.env.TRIAL_REQUIRES_PAYMENT_METHOD;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TRIAL_REQUIRES_PAYMENT_METHOD;
    } else {
      process.env.TRIAL_REQUIRES_PAYMENT_METHOD = original;
    }
  });

  it('vaut false par défaut (pas de CB exigée à l’inscription)', () => {
    delete process.env.TRIAL_REQUIRES_PAYMENT_METHOD;
    expect(loadAppConfig().trialRequiresPaymentMethod).toBe(false);
  });

  it('vaut true uniquement quand explicitement "true"', () => {
    process.env.TRIAL_REQUIRES_PAYMENT_METHOD = 'true';
    expect(loadAppConfig().trialRequiresPaymentMethod).toBe(true);
  });
});
