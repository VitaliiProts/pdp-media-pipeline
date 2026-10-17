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
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(opener).not.toHaveFocus();
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(dialog()).not.toHaveAttribute('open');
    expect(opener).toHaveFocus();
  });

  it('closes with its close button and on a click on the backdrop, not inside', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(dialog()).toHaveAttribute('open');
    fireEvent.pointerDown(dialog());
    fireEvent.click(dialog());
    expect(dialog()).not.toHaveAttribute('open');
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog()).not.toHaveAttribute('open');
    expect(opener).toHaveFocus();
  });

  it('stays open when a press starts inside and is released over the backdrop', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }));
    fireEvent.click(dialog());
    expect(dialog()).toHaveAttribute('open');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('reports a native close, e.g. from a dialog form, once', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Upload files" closeLabel="Close">
        <form method="dialog">
          <button type="submit">Done</button>
        </form>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dialog()).not.toHaveAttribute('open');
    expect(onClose).toHaveBeenCalledOnce();
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

  describe('with closeOnBackdrop={false}', () => {
    function renderSticky() {
      const onClose = vi.fn();
      render(
        <Dialog
          open
          closeOnBackdrop={false}
          onClose={onClose}
          title="Upload files"
          closeLabel="Close"
        >
          <p>Body</p>
        </Dialog>,
      );
      return onClose;
    }

    it('ignores a click on the backdrop', () => {
      const onClose = renderSticky();
      fireEvent.pointerDown(dialog());
      fireEvent.click(dialog());

      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).toHaveAttribute('open');
    });

    it('still closes on Escape and with its close button', async () => {
      const onClose = renderSticky();
      fireEvent(dialog(), new Event('cancel', { cancelable: true }));
      expect(onClose).toHaveBeenCalledOnce();

      const close = screen.getByRole('button', { name: 'Close' });
      expect(close).not.toHaveAttribute('aria-busy', 'true');
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('while not dismissible', () => {
    function renderHeld() {
      const onClose = vi.fn();
      render(
        <Dialog open dismissible={false} onClose={onClose} title="Upload files" closeLabel="Close">
          <p>Body</p>
        </Dialog>,
      );
      return onClose;
    }

    it('opens again after the browser closes it anyway', () => {
      const onClose = renderHeld();
      const element = dialog();
      if (!(element instanceof HTMLDialogElement)) throw new Error('expected a <dialog>');

      element.close();

      expect(element).toHaveAttribute('open');
      expect(screen.getByText('Body')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores Escape, the backdrop and its close button', async () => {
      const onClose = renderHeld();
      const cancel = new Event('cancel', { cancelable: true });
      fireEvent(dialog(), cancel);
      fireEvent.pointerDown(dialog());
      fireEvent.click(dialog());
      const close = screen.getByRole('button', { name: 'Close' });
      await userEvent.click(close);

      expect(cancel.defaultPrevented).toBe(true);
      expect(close).toHaveAttribute('aria-busy', 'true');
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog()).toHaveAttribute('open');
    });
  });
});
