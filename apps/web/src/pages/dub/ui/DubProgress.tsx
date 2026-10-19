import { useTranslation } from 'react-i18next';
import { Progress } from '../../../shared/ui/progress/Progress';
import { VisuallyHidden } from '../../../shared/ui/visually-hidden/VisuallyHidden';
import { DUB_STEPS, type DubStage, type DubStep, stepStateOf } from '../model/dub-job';
import { FAILURE_KEY } from './failure-keys';
import styles from './DubPage.module.css';

const STEP_KEY = {
  extract: 'steps.extract',
  separate: 'steps.separate',
  align: 'steps.align',
  translate: 'steps.translate',
  voice: 'steps.voice',
  mix: 'steps.mix',
} as const satisfies Record<DubStep, string>;

const STATE_KEY = {
  done: 'steps.done',
  current: 'steps.current',
  pending: 'steps.pending',
} as const;

type DubProgressProps = { stage: Extract<DubStage, { kind: 'waiting' | 'running' }> };

/** The steps of a dub under way; the page polls, so it follows the job to the end. */
export function DubProgress({ stage }: DubProgressProps) {
  const { t } = useTranslation('dub');
  const current = stage.kind === 'running' ? stage.step : null;
  const percent = stage.kind === 'running' ? stage.percent : null;

  return (
    <section className={styles.processing} aria-label={t('progress.label')}>
      <Progress
        className={styles.bar}
        label={t('progress.label')}
        // Empty while waiting, indeterminate until the worker reports a percent.
        value={stage.kind === 'waiting' ? 0 : percent === null ? undefined : percent / 100}
      />
      <p className={styles.quiet} role="status">
        {stage.kind === 'waiting'
          ? stage.retrying
            ? t('progress.retrying', { reason: t(FAILURE_KEY[stage.retrying]) })
            : t('progress.queued')
          : percent === null
            ? t('progress.started')
            : t('progress.percent', { percent: Math.round(percent) })}
      </p>
      <ol className={styles.steps} aria-label={t('steps.label')}>
        {DUB_STEPS.map((step) => {
          const state = stepStateOf(step, current);
          return (
            <li
              key={step}
              className={styles.step}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {t(STEP_KEY[step])}
              <VisuallyHidden> ({t(STATE_KEY[state])})</VisuallyHidden>
            </li>
          );
        })}
      </ol>
      <p className={styles.quiet}>{t('progress.leave')}</p>
    </section>
  );
}
