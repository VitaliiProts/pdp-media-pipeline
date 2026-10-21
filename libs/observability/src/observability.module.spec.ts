import { type IncomingMessage, type ServerResponse } from 'node:http';
import { httpLogLevel } from './observability.module';

describe('httpLogLevel', () => {
  const req = {} as IncomingMessage;

  it.each([
    [200, undefined, 'info'],
    [429, undefined, 'info'],
    [503, undefined, 'error'],
    [200, new Error('stream closed'), 'error'],
  ])('logs %i (error: %s) as %s', (statusCode, err, level) => {
    expect(httpLogLevel(req, { statusCode } as ServerResponse, err)).toBe(level);
  });
});
