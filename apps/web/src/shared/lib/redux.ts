import { createAsyncThunk, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

/** What the store gives every thunk. */
export type ThunkExtra = {
  /** Aborts when the user signs out: work started for them must not outlive the session. */
  sessionSignal: () => AbortSignal;
};

/**
 * Typed without the app's RootState, so features can dispatch thunks without
 * importing upward from `app/`. Slice selectors carry their own state shape.
 */
export const useAppDispatch =
  useDispatch.withTypes<ThunkDispatch<unknown, ThunkExtra, UnknownAction>>();
export const useAppSelector = useSelector;

export const createAppAsyncThunk = createAsyncThunk.withTypes<{ extra: ThunkExtra }>();
