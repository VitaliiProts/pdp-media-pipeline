import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import styles from '../page.module.css';

export function AssetPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <PageHeading>{t('asset.title')}</PageHeading>
      <EmptyState
        title={t('asset.emptyTitle')}
        action={
          <Link to="/library" className={buttonClass({ variant: 'secondary' })}>
            {t('asset.toLibrary')}
          </Link>
        }
      >
        <p>{t('asset.emptyBody')}</p>
      </EmptyState>
    </div>
  );
}
