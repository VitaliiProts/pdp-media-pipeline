import { useTranslation } from 'react-i18next';
import { STATUS_LABEL_KEY } from '../model/status-labels';
import { FILTERABLE_STATUSES, type JobStatusFilter } from '../model/types';
import styles from './StatusFilter.module.css';

type StatusFilterProps = {
  value: JobStatusFilter | null;
  onChange: (value: JobStatusFilter | null) => void;
};

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  const { t } = useTranslation('jobs');
  const options = [null, ...FILTERABLE_STATUSES];

  return (
    <div className={styles.group} role="group" aria-label={t('filter.label')}>
      {options.map((option) => (
        <button
          key={option ?? 'all'}
          type="button"
          className={styles.option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option ? t(STATUS_LABEL_KEY[option]) : t('filter.all')}
        </button>
      ))}
    </div>
  );
}
