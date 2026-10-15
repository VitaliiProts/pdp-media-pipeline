import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

const ITEMS = [
  { id: 'original', label: 'Original', panel: <p>Original file</p> },
  { id: 'results', label: 'Results', panel: <p>Resized images</p> },
  { id: 'jobs', label: 'Jobs', panel: <p>Job history</p> },
];

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('shows the first panel and makes only the selected tab tabbable', async () => {
    render(
      <>
        <button type="button">Before</button>
        <Tabs label="File" items={ITEMS} />
      </>,
    );
    expect(screen.getByRole('tablist', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Original' })).toHaveTextContent('Original file');
    await userEvent.click(screen.getByRole('button', { name: 'Before' }));
    await userEvent.tab();
    expect(tab('Original')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('moves with arrows, wraps around, and jumps with Home and End', async () => {
    render(<Tabs label="File" items={ITEMS} />);
    await userEvent.click(tab('Original'));
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Results')).toHaveFocus();
    expect(tab('Results')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Resized images');
    await userEvent.keyboard('{End}');
    expect(tab('Jobs')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Original')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Jobs')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tab('Original')).toHaveFocus();
  });

  it('reports the choice when controlled', async () => {
    const onSelect = vi.fn();
    render(<Tabs label="File" items={ITEMS} selectedId="jobs" onSelect={onSelect} />);
    expect(tab('Jobs')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab('Results'));
    expect(onSelect).toHaveBeenCalledWith('results');
    expect(tab('Jobs')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab when items arrive after mount', () => {
    const { rerender } = render(<Tabs label="File" items={[]} />);
    rerender(<Tabs label="File" items={ITEMS} />);
    expect(tab('Original')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Original')).toHaveAttribute('tabindex', '0');
  });

  it('falls back to the first tab when the selected item is removed', async () => {
    const { rerender } = render(<Tabs label="File" items={ITEMS} />);
    await userEvent.click(tab('Jobs'));
    rerender(<Tabs label="File" items={ITEMS.slice(0, 2)} />);
    expect(tab('Original')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Original')).toHaveAttribute('tabindex', '0');
    expect(tab('Results')).toHaveAttribute('tabindex', '-1');
  });

  it('passes native div props to its root', () => {
    render(<Tabs label="File" items={ITEMS} className="extra" data-testid="tabs" />);
    const root = screen.getByTestId('tabs');
    expect(root).toContainElement(screen.getByRole('tablist', { name: 'File' }));
    expect(root).toHaveClass('extra');
    expect(root.classList.length).toBeGreaterThan(1);
  });
});
