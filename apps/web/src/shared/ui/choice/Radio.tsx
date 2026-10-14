import { cx } from '../../lib/cx';
import { type ChoiceProps } from './Checkbox';
import styles from './Choice.module.css';

export function Radio({ label, detail, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx(styles.choice, className)}>
      <input {...rest} type="radio" className={styles.control} />
      <span className={styles.label}>{label}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </label>
  );
}
