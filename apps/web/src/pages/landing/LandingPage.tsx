import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../shared/ui/button/Button';
import { Card } from '../../shared/ui/card/Card';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import styles from '../page.module.css';
import landing from './LandingPage.module.css';

const FEATURE_KEYS = {
  images: { title: 'landing.features.images.title', body: 'landing.features.images.body' },
  video: { title: 'landing.features.video.title', body: 'landing.features.video.body' },
  library: { title: 'landing.features.library.title', body: 'landing.features.library.body' },
  api: { title: 'landing.features.api.title', body: 'landing.features.api.body' },
} as const;

export function LandingPage() {
  const { t } = useTranslation('shell');
  return (
    <div className={styles.page}>
      <PageHeading>{t('landing.title')}</PageHeading>
      <p className={styles.lead}>{t('landing.lead')}</p>
      <div className={styles.actions}>
        <Link to="/library" className={buttonClass({ variant: 'primary' })}>
          {t('landing.openLibrary')}
        </Link>
        <Link to="/register" className={buttonClass({ variant: 'secondary' })}>
          {t('register')}
        </Link>
      </div>
      <ul className={landing.features}>
        {Object.entries(FEATURE_KEYS).map(([name, keys]) => (
          <li key={name}>
            <Card className={landing.feature}>
              <h2 className={landing.title}>{t(keys.title)}</h2>
              <p className={landing.body}>{t(keys.body)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
