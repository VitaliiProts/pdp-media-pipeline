import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ToastInput, useToast } from './toast-context';
import { TOAST_TIMEOUT_MS, ToastProvider } from './ToastProvider';

function Trigger({ makeToast }: { makeToast: () => ToastInput }) {
  const show = useToast();
  return (
    <button type="button" onClick={() => show(makeToast())}>
      Show
    </button>
  );
}

function setup(toast: ToastInput | (() => ToastInput)) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const makeToast = typeof toast === 'function' ? toast : () => toast;
  render(
    <ToastProvider closeLabel="Close">
      <Trigger makeToast={makeToast} />
    </ToastProvider>,
  );
  return { user, show: () => user.click(screen.getByRole('button', { name: 'Show' })) };
}

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('announces politely and goes away on its own', async () => {
    const { show } = setup({ message: 'Uploading 2 files' });
    await show();
    const message = screen.getByText('Uploading 2 files');
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });
    expect(screen.queryByText('Uploading 2 files')).not.toBeInTheDocument();
  });

  it('puts errors into the assertive region', async () => {
    const { show } = setup({ tone: 'danger', message: 'a.png was not uploaded.' });
    await show();
    const message = screen.getByText('a.png was not uploaded.');
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
  });

  it('waits while the pointer is on it', async () => {
    const { user, show } = setup({ message: 'Hold me' });
    await show();
    await user.hover(screen.getByText('Hold me'));
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2);
    });
    expect(screen.getByText('Hold me')).toBeInTheDocument();
    await user.unhover(screen.getByText('Hold me'));
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });
    expect(screen.queryByText('Hold me')).not.toBeInTheDocument();
  });

  it('keeps waiting while focused, even after the pointer leaves', async () => {
    const { user, show } = setup({ message: 'Focus me' });
    await show();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.hover(screen.getByText('Focus me'));
    await user.unhover(screen.getByText('Focus me'));
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2);
    });
    expect(screen.getByText('Focus me')).toBeInTheDocument();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Show' })).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });
    expect(screen.queryByText('Focus me')).not.toBeInTheDocument();
  });

  it('closes with its button and keeps the newest three', async () => {
    let count = 0;
    const { user, show } = setup(() => {
      count += 1;
      return { message: `Toast ${count}` };
    });
    for (let i = 0; i < 4; i++) await show();
    expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
    for (const message of ['Toast 2', 'Toast 3', 'Toast 4']) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    const [first] = screen.getAllByRole('button', { name: 'Close' });
    if (!first) throw new Error('no close button');
    await user.click(first);
    expect(screen.queryByText('Toast 2')).not.toBeInTheDocument();
    expect(screen.getByText('Toast 3')).toBeInTheDocument();
    expect(screen.getByText('Toast 4')).toBeInTheDocument();
  });
});
