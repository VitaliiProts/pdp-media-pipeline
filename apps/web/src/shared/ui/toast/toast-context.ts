import { createContext, type ReactNode, useContext } from 'react';
import { type Tone } from '../tone';

export type ToastInput = { tone?: Tone; message: ReactNode; action?: ReactNode };

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast needs a ToastProvider above it');
  return show;
}
