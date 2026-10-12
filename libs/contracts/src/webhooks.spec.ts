import { generateWebhookSecret, isWebhookSecret, signWebhook, verifyWebhook } from './webhooks';

// Test vector from the Standard Webhooks reference libraries.
const vector = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

describe('signWebhook', () => {
  it('matches the Standard Webhooks test vector', () => {
    expect(signWebhook(vector)).toBe(vector.signature);
  });
});

describe('verifyWebhook', () => {
  const base = { ...vector, signatureHeader: vector.signature, nowSeconds: vector.timestamp };

  it('accepts a valid signature', () => {
    expect(verifyWebhook(base)).toBe(true);
  });

  it('accepts a header carrying several signatures', () => {
    expect(verifyWebhook({ ...base, signatureHeader: `v1,AAAA ${vector.signature}` })).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhook({ ...base, body: '{"test": 1}' })).toBe(false);
  });

  it('rejects another secret', () => {
    expect(verifyWebhook({ ...base, secret: generateWebhookSecret() })).toBe(false);
  });

  it('rejects a timestamp outside the tolerance', () => {
    expect(verifyWebhook({ ...base, nowSeconds: vector.timestamp + 10 * 60 })).toBe(false);
  });

  it('rejects unknown signature versions', () => {
    expect(verifyWebhook({ ...base, signatureHeader: vector.signature.replace('v1', 'v2') })).toBe(
      false,
    );
  });
});

describe('generateWebhookSecret', () => {
  it('produces a whsec_ secret usable for signing', () => {
    const secret = generateWebhookSecret();
    expect(isWebhookSecret(secret)).toBe(true);
    const signature = signWebhook({ secret, id: 'msg_1', timestamp: 1, body: '{}' });
    expect(
      verifyWebhook({
        secret,
        id: 'msg_1',
        timestamp: 1,
        body: '{}',
        signatureHeader: signature,
        nowSeconds: 1,
      }),
    ).toBe(true);
  });
});
