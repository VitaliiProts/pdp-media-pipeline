/** Tuned in spike 02 on five target languages; change only with a re-run of the dubs. */

const GENDER_RULE = [
  'Where the target grammar marks gender (past tense, adjectives, participles), speak about',
  'oneself in `speakerGender` and say "you" in `listenerGender` (the nearest other speaker,',
  'whom the line most likely addresses) unless the text clearly addresses someone else; this',
  'includes forms of address, nicknames and terms of endearment.',
  '`speakerGender` is about "I" only. "We" and "they" take the grammatical default for a mixed',
  'or unknown group (e.g. Spanish "nosotros", French masculine plural): a "we" of the speaker and',
  'a listener of the other gender is mixed, and so is a group of friends of both genders.',
  'With `unknown`, prefer gender-neutral wording.',
].join(' ');

const SPOKEN_ONLY = [
  'Every phrasing is read aloud by a speech synthesiser as is: only the words to be spoken, no',
  'notes, glosses, brackets, quotation marks around names or explanations of puns.',
].join(' ');

export const TRANSLATE_SYSTEM = [
  'You translate speech for dubbing. Each line will be spoken by a synthetic voice in the',
  '`seconds` the original speaker took, so its spoken length should match: `maxChars` is a rough',
  'limit. For every line give three natural spoken phrasings, each clearly shorter than the one',
  'before: the first is a faithful translation that fits, the last keeps only the core meaning.',
  'Never change who does what or the meaning. Keep tone and register; insults, threats and',
  'slang stay as strong as in the original, never softened.',
  'Lines with the same `turn` are consecutive parts of one utterance split at the pauses of the',
  'speaker: each part is spoken in its own time, so keep the content of each part in that part',
  'as far as the target grammar allows, and let the parts read as one utterance.',
  'Write numbers, dates, times and units out the way they are spoken. Return every id once.',
  '`sourceLanguage` is the language of the original, or `auto` to detect it; return it as an',
  'ISO 639-1 code.',
  GENDER_RULE,
  SPOKEN_ONLY,
].join(' ');

export const REFIT_SYSTEM = [
  'You fit one dubbing line to its time: rephrase the translation `fullest` of `original` to',
  'about `words` words. Give three phrasings: a little shorter than that, about that, a little',
  'longer. Drop filler before meaning; same meaning, tone and strength as the original.',
  'A longer phrasing says the same thing more fully; it never adds a statement, a request or a',
  'repetition the original does not have.',
  '`before` and `after` are the neighbouring parts of the same utterance: the phrasing continues',
  'them and agrees with them grammatically.',
  GENDER_RULE,
  SPOKEN_ONLY,
].join(' ');

const jsonSchema = (name: string, schema: object) => ({
  type: 'json_schema',
  json_schema: { name, strict: true, schema },
});

export const TRANSLATION_FORMAT = jsonSchema('dub_translation', {
  type: 'object',
  additionalProperties: false,
  required: ['sourceLanguage', 'segments'],
  properties: {
    sourceLanguage: { type: 'string', description: 'ISO 639-1 code of the original speech' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'variants'],
        properties: {
          id: { type: 'string' },
          variants: {
            type: 'array',
            description: 'Three phrasings from the fullest to the shortest',
            items: { type: 'string' },
          },
        },
      },
    },
  },
});

export const REFIT_FORMAT = jsonSchema('dub_refit', {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: { variants: { type: 'array', items: { type: 'string' } } },
});
