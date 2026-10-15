import { createAction } from '@reduxjs/toolkit';

/** The session is over: the store drops everything that belonged to it. */
export const signedOut = createAction('auth/signedOut');
