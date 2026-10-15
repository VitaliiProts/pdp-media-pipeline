import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCountdown } from '../../../shared/lib/use-countdown';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useRegisterMutation } from '../api/auth-api';
import { type AuthFailure, authFailureOf } from '../model/auth-failure';
import {
  emailProblem,
  type FieldProblem,
  NAME_MAX_LENGTH,
  nameProblem,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from '../model/validate';
import styles from './AuthForm.module.css';
import { FormFailure } from './FormFailure';

type Problems = {
  name: FieldProblem | null;
  email: FieldProblem | null;
  password: FieldProblem | null;
};
const NO_PROBLEMS: Problems = { name: null, email: null, password: null };

/** `loginHref` is where "Sign in instead" leads when the email is taken; it keeps `next`. */
export function RegisterForm({ loginHref }: { loginHref: string }) {
  const { t } = useTranslation('auth');
  const [register, { isLoading }] = useRegisterMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = {
      name: nameProblem(name),
      email: emailProblem(email),
      password: passwordProblem(password, { isNew: true }),
    };
    setProblems(found);
    if (found.name) {
      nameRef.current?.focus();
      return;
    }
    if (found.email) {
      emailRef.current?.focus();
      return;
    }
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }

    setFailure(null);
    const trimmedName = name.trim();
    try {
      await register({
        ...(trimmedName && { name: trimmedName }),
        email: email.trim(),
        password,
      }).unwrap();
    } catch (error) {
      const next = authFailureOf(error);
      setFailure(next);
      if (next.kind === 'retryLater') startCountdown(next.retryAfterS);
      if (next.kind === 'emailTaken') emailRef.current?.focus();
    }
  };

  const emailError =
    failure?.kind === 'emailTaken' ? (
      <>
        {t('failure.emailTaken')} <Link to={loginHref}>{t('failure.emailTakenAction')}</Link>
      </>
    ) : problems.email ? (
      t(`problem.email.${problems.email}`)
    ) : undefined;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field
        label={t('name')}
        hint={t('nameHint')}
        error={
          problems.name ? t(`problem.name.${problems.name}`, { count: NAME_MAX_LENGTH }) : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            ref={nameRef}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('email')} error={emailError}>
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
      <Field
        label={t('password')}
        hint={t('newPasswordHint', { count: PASSWORD_MIN_LENGTH })}
        error={
          problems.password
            ? t(`problem.password.${problems.password}`, {
                count: problems.password === 'tooLong' ? PASSWORD_MAX_LENGTH : PASSWORD_MIN_LENGTH,
              })
            : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
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
        {t('register.submit')}
      </Button>
    </form>
  );
}
