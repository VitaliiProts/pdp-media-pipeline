import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox';
import { ChoiceGroup } from './ChoiceGroup';
import { Radio } from './Radio';

describe('choices', () => {
  it('groups checkboxes under a legend and toggles them through the label', async () => {
    render(
      <ChoiceGroup legend="Sizes">
        <Checkbox label="Thumbnail" detail="200 px wide" defaultChecked />
        <Checkbox label="Large" detail="1600 px wide" />
      </ChoiceGroup>,
    );
    const group = screen.getByRole('group', { name: 'Sizes' });
    expect(group).toBeInTheDocument();
    const large = screen.getByRole('checkbox', { name: /Large/ });
    await userEvent.click(screen.getByText('Large'));
    expect(large).toBeChecked();
    // Adjacent spans join without a space in the accessible name, so match the label only.
    expect(screen.getByRole('checkbox', { name: /Thumbnail/ })).toBeChecked();
  });

  it('selects one radio of a group', async () => {
    render(
      <ChoiceGroup legend="Videos">
        <Radio name="mode" label="Frames" defaultChecked />
        <Radio name="mode" label="Transcode" />
      </ChoiceGroup>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Transcode' }));
    expect(screen.getByRole('radio', { name: 'Transcode' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Frames' })).not.toBeChecked();
  });
});
