import { useCallback, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiKeysSection } from '../../features/api-keys';
import { useGetMeQuery } from '../../features/auth';
import { LanguageSwitch } from '../../features/language';
import { Card } from '../../shared/ui/card/Card';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import pageStyles from '../page.module.css';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { data: me } = useGetMeQuery();
  const ids = { profile: useId(), language: useId(), keys: useId() };
  const keysHeading = useRef<HTMLHeadingElement>(null);
  const focusKeysHeading = useCallback(() => keysHeading.current?.focus(), []);

  return (
    <div className={`${pageStyles.page} ${pageStyles.narrow}`}>
      <PageHeading>{t('title')}</PageHeading>
      <Card>
        <section aria-labelledby={ids.profile}>
          <h2 id={ids.profile} className={styles.heading}>
            {t('profile.title')}
          </h2>
          {me && (
            <dl className={styles.facts}>
              <div>
                <dt>{t('profile.name')}</dt>
                <dd>{me.name}</dd>
              </div>
              {me.email && (
                <div>
                  <dt>{t('profile.email')}</dt>
                  <dd>{me.email}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      </Card>
      <Card>
        <section aria-labelledby={ids.language}>
          <h2 id={ids.language} className={styles.heading}>
            {t('language.title')}
          </h2>
          <LanguageSwitch />
        </section>
      </Card>
      <Card>
        <section aria-labelledby={ids.keys}>
          <h2 id={ids.keys} ref={keysHeading} tabIndex={-1} className={styles.heading}>
            {t('apiKeys.title')}
          </h2>
          <p className={styles.lead}>{t('apiKeys.lead')}</p>
          <ApiKeysSection onRevoked={focusKeysHeading} />
        </section>
      </Card>
    </div>
  );
}
