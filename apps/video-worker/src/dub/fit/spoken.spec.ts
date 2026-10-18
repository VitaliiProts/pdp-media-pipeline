import { spoken } from './spoken';

describe('spoken', () => {
  it('drops control characters, quotation marks and brackets but keeps the words', () => {
    expect(spoken('Він сказав: «Тікай» (швидко)\u0007 ')).toBe('Він сказав: Тікай швидко');
    expect(spoken('She said "run" [now]\n')).toBe('She said run now');
  });

  it('keeps apostrophes inside words', () => {
    expect(spoken("м'ята, п’ять, it's")).toBe("м'ята, п’ять, it's");
  });

  it('leaves nothing of a line without words', () => {
    expect(spoken(' «» ()\t')).toBe('');
  });
});
