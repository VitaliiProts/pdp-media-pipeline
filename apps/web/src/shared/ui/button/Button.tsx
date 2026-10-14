import { type ComponentProps, type MouseEvent } from 'react';
import { cx } from '../../lib/cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'sm';

type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize };

/** The button look for elements that are not buttons, e.g. router links. */
export function buttonClass(
  { variant = 'secondary', size = 'md' }: ButtonLook = {},
  extra?: string,
) {
  return cx(styles.button, styles[variant], size === 'sm' && styles.sm, extra);
}

export type ButtonProps = ComponentProps<'button'> &
  ButtonLook & {
    /** The action is in progress: further clicks are ignored, focus stays. */
    isBusy?: boolean;
  };

export function Button({
  variant,
  size,
  isBusy = false,
  className,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isBusy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={buttonClass({ variant, size }, className)}
      aria-busy={isBusy || undefined}
      aria-disabled={isBusy || rest['aria-disabled'] || undefined}
      onClick={handleClick}
    />
  );
}
