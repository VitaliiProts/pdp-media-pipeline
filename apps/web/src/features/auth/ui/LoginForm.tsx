import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCountdown } from '../../../shared/lib/use-countdown';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useLoginMutation } from '../api/auth-api';
import { type AuthFailure, authFailureOf } from '../model/auth-failure';
import {
  emailProblem,
  type FieldProblem,
  PASSWORD_MAX_LENGTH,
  passwordProblem,
} from '../model/validate';
import styles from './AuthForm.module.css';
import { FormFailure } from './FormFailure';

type Problems = { email: FieldProblem | null; password: FieldProblem | null };
const NO_PROBLEMS: Problems = { email: null, password: null };

/** On success the store resets the API cache; the page sees `getMe` succeed and moves on. */
export function LoginForm() {
  const { t } = useTranslation('auth');
  const [login, { isLoading }] = useLoginMutation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = {
      email: emailProblem(email),
      password: passwordProblem(password, { isNew: false }),
    };
    setProblems(found);
    if (found.email) {
      emailRef.current?.focus();
      return;
    }
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }

    setFailure(null);
    try {
      await login({ email: email.trim(), password }).unwrap();
    } catch (error) {
      const next = authFailureOf(error);
      setFailure(next);
      if (next.kind === 'retryLater') startCountdown(next.retryAfterS);
      if (next.kind === 'credentials') {
        setPassword('');
        passwordRef.current?.focus();
      }
    }
  };

  const problemText = (field: 'email' | 'password', problem: FieldProblem | null) =>
    problem ? t(`problem.${field}.${problem}`, { count: PASSWORD_MAX_LENGTH }) : undefined;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field label={t('email')} error={problemText('email', problems.email)}>
        {(control) => (
          <Input
            {...control}
            ref={emailRef}
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('password')} error={problemText('password', problems.password)}>
        {(control) => (
          <Input
            {...control}
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <FormFailure failure={failure} secondsLeft={secondsLeft} />
      <Button
        variant="primary"
        type="submit"
        className={styles.submit}
        isBusy={isLoading}
        disabled={secondsLeft > 0}
      >
        {t('login.submit')}
      </Button>
    </form>
  );
}
