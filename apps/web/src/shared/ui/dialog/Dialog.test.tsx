import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from './Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Upload files" closeLabel="Close">
        <p>Body</p>
        <button type="button">Inside</button>
      </Dialog>
    </>
  );
}

const dialog = () => screen.getByRole('dialog', { hidden: true });

describe('Dialog', () => {
  it('opens as a modal named by its title and renders content only while open', async () => {
    render(<Harness />);
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Upload files' })).toHaveAttribute('open');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(dialog()).not.toHaveAttribute('open');
    expect(opener).toHaveFocus();
  });

  it('closes with its close button and on a click on the backdrop, not inside', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(dialog()).toHaveAttribute('open');
    fireEvent.click(dialog());
    expect(dialog()).not.toHaveAttribute('open');

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog()).not.toHaveAttribute('open');
  });

  it('passes native props to the dialog and keeps its title as the name', () => {
    render(
      <Dialog
        open
        onClose={() => undefined}
        title="Upload files"
        closeLabel="Close"
        className="extra"
        data-testid="upload-dialog"
      >
        <p>Body</p>
      </Dialog>,
    );
    const element = screen.getByRole('dialog', { name: 'Upload files' });
    expect(element).toHaveAttribute('data-testid', 'upload-dialog');
    expect(element).toHaveClass('extra');
    expect(element.classList.length).toBeGreaterThan(1);
  });
});
