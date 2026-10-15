import { useTranslation } from 'react-i18next';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { WebhooksView } from '../workspace/ui/WebhooksView';

export function WebhooksPage() {
  const { t } = useTranslation('shell');
  return (
    <>
      <PageHeading>{t('nav.webhooks')}</PageHeading>
      <WebhooksView />
    </>
  );
}
