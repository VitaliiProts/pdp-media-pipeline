import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ToastInput, useToast } from './toast-context';
import { TOAST_TIMEOUT_MS, ToastProvider } from './ToastProvider';

function Trigger({ toast }: { toast: ToastInput }) {
  const show = useToast();
  return (
    <button type="button" onClick={() => show(toast)}>
      Show
    </button>
  );
}

function setup(toast: ToastInput) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <ToastProvider closeLabel="Close">
      <Trigger toast={toast} />
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

  it('closes with its button and keeps at most three', async () => {
    const { user, show } = setup({ message: 'Again' });
    for (let i = 0; i < 4; i++) await show();
    expect(screen.getAllByText('Again')).toHaveLength(3);
    const [first] = screen.getAllByRole('button', { name: 'Close' });
    if (!first) throw new Error('no close button');
    await user.click(first);
    expect(screen.getAllByText('Again')).toHaveLength(2);
  });
});
