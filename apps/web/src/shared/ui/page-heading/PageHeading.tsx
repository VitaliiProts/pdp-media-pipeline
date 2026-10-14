import { type ComponentProps, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { cx } from '../../lib/cx';
import styles from './PageHeading.module.css';

const APP_NAME = 'PDP Media Pipeline';

type PageHeadingProps = Omit<ComponentProps<'h1'>, 'children' | 'ref' | 'tabIndex'> & {
  children: string;
  ref?: never;
  tabIndex?: never;
};

/**
 * The page's `h1`. It names the browser tab and, after client-side navigation,
 * takes focus, so screen readers notice the new page. The first render keeps
 * focus where the browser put it.
 */
export function PageHeading({ children, className, ...rest }: PageHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();

  useEffect(() => {
    document.title = `${children} — ${APP_NAME}`;
  }, [children]);

  useEffect(() => {
    if (key !== 'default') ref.current?.focus();
  }, [key]);

  return (
    <h1 {...rest} ref={ref} tabIndex={-1} className={cx(styles.heading, className)}>
      {children}
    </h1>
  );
}
