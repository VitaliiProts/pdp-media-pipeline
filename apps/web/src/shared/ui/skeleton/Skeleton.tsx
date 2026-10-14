import { cx } from '../../lib/cx';
import styles from './Skeleton.module.css';

type SkeletonProps = {
  width?: string;
  height?: string;
  radius?: 'control' | 'mount';
  className?: string;
};

/** A placeholder in the shape of content that is loading; the container sets `aria-busy`. */
export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = 'control',
  className,
}: SkeletonProps) {
  return (
    <div
      className={cx(styles.skeleton, className)}
      data-radius={radius}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
