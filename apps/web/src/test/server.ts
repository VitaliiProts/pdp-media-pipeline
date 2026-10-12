import { setupServer } from 'msw/node';

export const STORAGE_ORIGIN = 'http://storage.test';

/** Each test declares the handlers it relies on; unknown requests fail the test. */
export const server = setupServer();
