/**
 * The text as the synthesiser should read it: it voices every character, so control
 * characters, quotation marks and brackets from the model would be noise or odd pauses.
 */
export const spoken = (text: string): string =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["«»„“”‟‹›()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
