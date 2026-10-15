import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';
import { testSession } from './session';

// jsdom has no object URLs; previews only need a stable string.
let objectUrlCount = 0;
URL.createObjectURL = () => `blob:preview-${++objectUrlCount}`;
URL.revokeObjectURL = () => undefined;

// jsdom has no modal dialogs; enough of one for the open state and the close event.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event('close'));
};
// jsdom does not submit forms; a `method="dialog"` submission closes its dialog.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (event.defaultPrevented || !(form instanceof HTMLFormElement) || form.method !== 'dialog') {
    return;
  }
  event.preventDefault();
  form.closest('dialog')?.close();
});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  testSession.signOut();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterAll(() => server.close());
