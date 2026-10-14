import { type Counter, type MeterProvider, metrics } from '@opentelemetry/api';

export type LoginOutcome = 'success' | 'invalid_credentials' | 'rate_limited';
export type RegistrationOutcome = 'success' | 'email_taken' | 'rate_limited';

interface AuthInstruments {
  logins: Counter;
  registrations: Counter;
}

const cache = new WeakMap<MeterProvider, AuthInstruments>();

/** Created on first use per provider, like the job metrics: see `metrics.ts`. */
function instruments(): AuthInstruments {
  const provider = metrics.getMeterProvider();
  const existing = cache.get(provider);
  if (existing) return existing;

  const meter = provider.getMeter('@pdp/auth');
  const created: AuthInstruments = {
    logins: meter.createCounter('auth.logins', {
      description: 'Login attempts at the gateway by outcome; a burst of failures is an attack',
      unit: '{attempt}',
    }),
    registrations: meter.createCounter('auth.registrations', {
      description: 'Registration attempts at the gateway by outcome',
      unit: '{attempt}',
    }),
  };
  cache.set(provider, created);
  return created;
}

export const authMetrics = {
  login(outcome: LoginOutcome): void {
    instruments().logins.add(1, { outcome });
  },

  registration(outcome: RegistrationOutcome): void {
    instruments().registrations.add(1, { outcome });
  },
};
