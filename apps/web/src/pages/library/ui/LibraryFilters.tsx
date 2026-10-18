import { type Ref, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ASSET_SEARCH_MAX_LENGTH,
  ASSET_STATUSES,
  type AssetFilters,
} from '../../../features/assets';
import { Checkbox } from '../../../shared/ui/choice/Checkbox';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { Select } from '../../../shared/ui/select/Select';
import { type SetFilters } from '../lib/use-library-params';
import styles from './LibraryFilters.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const KIND_OPTIONS = [null, 'image', 'video'] as const;

type LibraryFiltersProps = {
  filters: AssetFilters;
  onChange: SetFilters;
  searchRef: Ref<HTMLInputElement>;
};

export function LibraryFilters({ filters, onChange, searchRef }: LibraryFiltersProps) {
  const { t } = useTranslation('assets');
  const kindName = useId();
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  // The URL changed from outside (reset, back button): show what it says now.
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    if (filters.q !== draft.trim()) setDraft(filters.q);
  }

  useEffect(() => {
    const q = draft.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => onChange({ q }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, filters.q, onChange]);

  return (
    <div className={styles.filters}>
      <ChoiceGroup legend={t('library.kind.legend')} className={styles.kinds}>
        {KIND_OPTIONS.map((kind) => (
          <Radio
            key={kind ?? 'all'}
            name={kindName}
            className={styles.segment}
            label={t(`library.kind.${kind ?? 'all'}`)}
            checked={filters.kind === kind}
            onChange={() => onChange({ kind })}
          />
        ))}
      </ChoiceGroup>
      <Field label={t('library.status.label')} className={styles.status}>
        {(control) => (
          <Select
            {...control}
            value={filters.status ?? ''}
            onChange={(event) =>
              onChange({ status: ASSET_STATUSES.find((s) => s === event.target.value) ?? null })
            }
          >
            <option value="">{t('library.status.any')}</option>
            {ASSET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`library.status.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        className={styles.dubbed}
        label={t('library.dubbed')}
        checked={filters.dubbed}
        onChange={(event) => onChange({ dubbed: event.target.checked })}
      />
      <Field label={t('library.search')} className={styles.search}>
        {(control) => (
          <Input
            {...control}
            ref={searchRef}
            type="search"
            maxLength={ASSET_SEARCH_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
