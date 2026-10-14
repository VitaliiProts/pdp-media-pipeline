import { EmailSchema, LoginRequest, RegisterRequest } from './accounts';

describe('accounts contracts', () => {
  it('normalises the email to one form per mailbox', () => {
    expect(EmailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('rejects what is not an email', () => {
    expect(EmailSchema.safeParse('alice').success).toBe(false);
  });

  it('enforces the password length on register, not on login', () => {
    expect(RegisterRequest.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(LoginRequest.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });
});
