import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';

// jsdom has no object URLs; previews only need a stable string.
let objectUrlCount = 0;
URL.createObjectURL = () => `blob:preview-${++objectUrlCount}`;
URL.revokeObjectURL = () => undefined;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterAll(() => server.close());
