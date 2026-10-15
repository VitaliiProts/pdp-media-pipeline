import { type ComponentProps, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { cx } from '../../lib/cx';
import styles from './PageHeading.module.css';

const APP_NAME = 'PDP Media Pipeline';

/** The browser tab's name for a page headed `heading`; prerendered pages carry it in `<title>`. */
export const pageTitle = (heading: string) => `${heading} — ${APP_NAME}`;

type PageHeadingProps = Omit<ComponentProps<'h1'>, 'children' | 'ref' | 'tabIndex'> & {
  children: string;
  ref?: never;
  tabIndex?: never;
};

/**
 * The page's `h1`. It names the browser tab and, after client-side navigation
 * to another path, takes focus, so screen readers notice the new page. The first
 * render keeps focus where the browser put it.
 */
export function PageHeading({ children, className, ...rest }: PageHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const focusedPathname = useRef<string | null>(null);
  const { key, pathname } = useLocation();

  useEffect(() => {
    document.title = pageTitle(children);
  }, [children]);

  useEffect(() => {
    // Query-only navigations (filters) keep the focus on the control that caused them.
    if (focusedPathname.current === pathname) return;
    focusedPathname.current = pathname;
    if (key !== 'default') ref.current?.focus();
  }, [key, pathname]);

  return (
    <h1 {...rest} ref={ref} tabIndex={-1} className={cx(styles.heading, className)}>
      {children}
    </h1>
  );
}
