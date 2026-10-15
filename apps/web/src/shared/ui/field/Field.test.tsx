import { render, screen } from '@testing-library/react';
import { Field } from './Field';
import { Input } from './Input';

describe('Field', () => {
  it('names the control and describes it with the hint and the error', () => {
    render(
      <Field label="Email" hint="We never share it." error="Enter a valid email.">
        {(control) => <Input {...control} type="email" />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('We never share it. Enter a valid email.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('is neither described nor invalid without hint and error', () => {
    render(<Field label="Name">{(control) => <Input {...control} />}</Field>);
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('treats an empty error as absent', () => {
    const { container } = render(
      <Field label="Name" error="">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(container.querySelector('p')).toBeNull();
  });

  it('passes native div props to its root', () => {
    const { container } = render(
      <Field label="Name" className="extra" id="name-field">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('id', 'name-field');
    expect(root).toHaveClass('extra');
    expect(root?.classList.length).toBeGreaterThan(1);
  });
});
