import { cx } from './cx';

it('joins the class names that are set', () => {
  expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
});
