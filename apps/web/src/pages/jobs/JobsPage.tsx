import { useTranslation } from 'react-i18next';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { JobsView } from '../workspace/ui/JobsView';

export function JobsPage() {
  const { t } = useTranslation('shell');
  return (
    <>
      <PageHeading>{t('nav.jobs')}</PageHeading>
      <JobsView />
    </>
  );
}
