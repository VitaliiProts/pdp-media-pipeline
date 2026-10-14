import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from './badge/Badge';
import { Progress } from './progress/Progress';
import { Skeleton } from './skeleton/Skeleton';
import { EmptyState } from './state/EmptyState';
import { ErrorState } from './state/ErrorState';

describe('display primitives', () => {
  it('Badge carries its meaning in text', () => {
    render(<Badge tone="success">Done</Badge>);
    expect(screen.getByText('Done')).toHaveAttribute('data-tone', 'success');
  });

  it('Progress is a named progressbar, indeterminate without a value', () => {
    const { rerender } = render(<Progress label="Upload" value={0.4} />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar).toHaveAttribute('value', '0.4');
    rerender(<Progress label="Upload" />);
    expect(screen.getByRole('progressbar', { name: 'Upload' })).not.toHaveAttribute('value');
  });

  it('Skeleton is hidden from assistive technology', () => {
    const { container } = render(<Skeleton height="2rem" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('EmptyState names the situation and offers the next step', () => {
    render(
      <EmptyState title="No jobs yet" action={<button type="button">Upload a file</button>}>
        Upload an image to start.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'No jobs yet' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Upload an image to start.');
    expect(screen.getByRole('button', { name: 'Upload a file' })).toBeInTheDocument();
  });

  it('ErrorState alerts and retries', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState title="Could not load jobs" retry={{ label: 'Try again', onRetry }}>
        Is the gateway running?
      </ErrorState>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load jobs');
    expect(alert).toHaveTextContent('Is the gateway running?');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
