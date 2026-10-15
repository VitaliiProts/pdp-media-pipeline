import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { cx } from '../../lib/cx';
import styles from './Tabs.module.css';

export type TabItem = { id: string; label: ReactNode; panel: ReactNode };

type TabsProps = Omit<ComponentProps<'div'>, 'children' | 'onSelect'> & {
  label: string;
  items: readonly TabItem[];
  /** Controlled selection; without it the component keeps its own. */
  selectedId?: string;
  onSelect?: (id: string) => void;
};

/** WAI-ARIA tabs with automatic activation and a roving tabindex. */
export function Tabs({ label, items, selectedId, onSelect, className, ...rest }: TabsProps) {
  const baseId = useId();
  const [ownSelectedId, setOwnSelectedId] = useState(items[0]?.id);
  const requested = selectedId ?? ownSelectedId;
  const current = items.some((item) => item.id === requested) ? requested : items[0]?.id;
  const tabs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    setOwnSelectedId(id);
    onSelect?.(id);
  };

  const moveTo = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    select(item.id);
    tabs.current.get(item.id)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        moveTo(index + 1);
        break;
      case 'ArrowLeft':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(items.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div {...rest} className={cx(styles.tabs, className)}>
      <div role="tablist" aria-label={label} className={styles.list}>
        {items.map((item, index) => {
          const isSelected = item.id === current;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabs.current.set(item.id, node);
                else tabs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              className={styles.tab}
              onClick={() => select(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== current}
          tabIndex={0}
          className={styles.panel}
        >
          {item.id === current && item.panel}
        </div>
      ))}
    </div>
  );
}
