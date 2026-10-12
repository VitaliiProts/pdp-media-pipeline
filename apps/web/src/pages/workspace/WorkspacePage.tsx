import { useTranslation } from 'react-i18next';
import { apiKeyCleared } from '../../features/api-key';
import { useAppDispatch } from '../../shared/lib/redux';
import { useViewParam, VIEWS } from './lib/use-view-param';
import { JobsView } from './ui/JobsView';
import { LanguageSwitch } from './ui/LanguageSwitch';
import { WebhooksView } from './ui/WebhooksView';
import styles from './WorkspacePage.module.css';

const VIEW_LABEL_KEY = { jobs: 'views.jobs', webhooks: 'views.webhooks' } as const;

export function WorkspacePage() {
  const { t } = useTranslation('workspace');
  const dispatch = useAppDispatch();
  const [view, setView] = useViewParam();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>{t('subtitle')}</p>
        <nav className={styles.tools}>
          <div className={styles.views} role="group" aria-label={t('views.label')}>
            {VIEWS.map((name) => (
              <button
                key={name}
                type="button"
                className={styles.viewTab}
                aria-pressed={view === name}
                onClick={() => setView(name)}
              >
                {t(VIEW_LABEL_KEY[name])}
              </button>
            ))}
          </div>
          <a className={styles.link} href="/docs" target="_blank" rel="noreferrer">
            {t('apiDocs')}
          </a>
          <LanguageSwitch />
          <button
            type="button"
            className={styles.signOut}
            onClick={() => dispatch(apiKeyCleared())}
          >
            {t('changeKey')}
          </button>
        </nav>
      </header>

      <main className={styles.main}>{view === 'jobs' ? <JobsView /> : <WebhooksView />}</main>
    </div>
  );
}
