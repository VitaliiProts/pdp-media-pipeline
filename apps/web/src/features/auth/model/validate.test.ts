import { emailProblem, nameProblem, passwordProblem } from './validate';

describe('sign-in rules', () => {
  it('wants an email that looks like one', () => {
    expect(emailProblem('')).toBe('required');
    expect(emailProblem('   ')).toBe('required');
    expect(emailProblem('alice')).toBe('format');
    expect(emailProblem('alice@example')).toBe('format');
    expect(emailProblem(' alice@example.com ')).toBeNull();
    expect(emailProblem(`${'a'.repeat(250)}@x.io`)).toBe('tooLong');
  });

  it('checks the length of a new password only', () => {
    expect(passwordProblem('', { isNew: false })).toBe('required');
    expect(passwordProblem('short', { isNew: false })).toBeNull();
    expect(passwordProblem('short', { isNew: true })).toBe('tooShort');
    expect(passwordProblem('long enough', { isNew: true })).toBeNull();
    expect(passwordProblem('x'.repeat(129), { isNew: true })).toBe('tooLong');
  });

  it('lets the name be empty but not too long', () => {
    expect(nameProblem('')).toBeNull();
    expect(nameProblem('x'.repeat(101))).toBe('tooLong');
  });
});
