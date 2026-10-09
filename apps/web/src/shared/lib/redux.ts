import { type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

/**
 * Typed without the app's RootState, so features can dispatch thunks without
 * importing upward from `app/`. Slice selectors carry their own state shape.
 */
export const useAppDispatch =
  useDispatch.withTypes<ThunkDispatch<unknown, unknown, UnknownAction>>();
export const useAppSelector = useSelector;
