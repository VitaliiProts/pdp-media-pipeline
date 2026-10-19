import { languageName } from './language-name';

describe('languageName', () => {
  it('names a language in the language of the page, capitalised', () => {
    expect(languageName('uk', 'en')).toBe('Ukrainian');
    expect(languageName('de', 'uk')).toBe('Німецька');
  });

  it('falls back to the code', () => {
    expect(languageName('xx', 'en')).toBe('xx');
  });
});
