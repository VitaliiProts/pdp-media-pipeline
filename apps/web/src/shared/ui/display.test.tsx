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

  it('ErrorState passes native props to its root and keeps the alert role', () => {
    render(<ErrorState title="Could not load jobs" className="extra" id="jobs-error" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'jobs-error');
    expect(alert).toHaveClass('extra');
    expect(alert.classList.length).toBeGreaterThan(1);
  });

  it('EmptyState passes native props to its root and keeps the status role', () => {
    render(<EmptyState title="No jobs yet" className="extra" data-testid="empty" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-testid', 'empty');
    expect(status).toHaveClass('extra');
    expect(status.classList.length).toBeGreaterThan(1);
  });

  it('states never leak a numeric 0 as a stray text node', () => {
    render(
      <EmptyState title="No jobs yet" action={0}>
        {0}
      </EmptyState>,
    );
    const nodes = [...screen.getByRole('status').childNodes];
    expect(nodes.filter((node) => node.nodeType === Node.TEXT_NODE)).toHaveLength(0);
    expect(nodes).toHaveLength(3);
  });

  it('Progress passes native props to its root', () => {
    render(<Progress label="Upload" value={0.4} className="extra" id="upload-progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar).toHaveAttribute('id', 'upload-progress');
    expect(bar).toHaveClass('extra');
    expect(bar.classList.length).toBeGreaterThan(1);
  });

  it('Skeleton passes native props and merges the caller style', () => {
    const { container } = render(
      <Skeleton
        height="2rem"
        className="extra"
        data-testid="skeleton"
        style={{ width: '1px', marginTop: '4px' }}
      />,
    );
    const skeleton = container.firstElementChild;
    expect(skeleton).toHaveAttribute('data-testid', 'skeleton');
    expect(skeleton).toHaveClass('extra');
    expect(skeleton).toHaveStyle({ width: '100%', height: '2rem', marginTop: '4px' });
  });
});
