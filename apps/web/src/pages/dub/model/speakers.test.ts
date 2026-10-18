import { TEST_DUB } from '../../../test/dub-fixtures';
import { choiceOf, overridesOf, withGender } from './speakers';

const [a, b] = TEST_DUB.speakers;

describe('speaker corrections', () => {
  it('moves to the same place in the other gender’s voices', () => {
    expect(withGender({ gender: 'male', voice: 'M3' }, 'female')).toEqual({
      gender: 'female',
      voice: 'F3',
    });
    expect(withGender({ gender: 'female', voice: 'F2' }, 'female')).toEqual({
      gender: 'female',
      voice: 'F2',
    });
  });

  it('sends only what changed', () => {
    expect(
      overridesOf(TEST_DUB.speakers, {
        A: choiceOf(a!),
        B: { gender: 'male', voice: 'M2' },
      }),
    ).toEqual({ B: { gender: 'male', voice: 'M2' } });
    expect(overridesOf(TEST_DUB.speakers, { A: choiceOf(a!), B: choiceOf(b!) })).toEqual({});
  });
});
