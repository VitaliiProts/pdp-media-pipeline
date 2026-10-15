import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from './VisuallyHidden';

it('passes native props through, so it can be a description target', () => {
  render(
    <>
      <button type="button" aria-describedby="save-hint">
        Save
      </button>
      <VisuallyHidden id="save-hint">Saves a draft</VisuallyHidden>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription('Saves a draft');
});
