import { type ComponentProps } from 'react';
import { cx } from '../../lib/cx';
import styles from './Skeleton.module.css';

type SkeletonProps = Omit<ComponentProps<'div'>, 'children' | 'aria-hidden'> & {
  width?: string;
  height?: string;
  radius?: 'control' | 'mount';
  'aria-hidden'?: never;
  'data-radius'?: never;
};

/** A placeholder in the shape of content that is loading; the container sets `aria-busy`. */
export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = 'control',
  className,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <div
      {...rest}
      className={cx(styles.skeleton, className)}
      data-radius={radius}
      style={{ ...style, width, height }}
      aria-hidden="true"
    />
  );
}
