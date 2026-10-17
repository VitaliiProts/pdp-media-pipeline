export type AuthMethod = 'api-key' | 'session';

/** `GET /v1/me`: the signed-in user and how this request was authenticated. */
export type Me = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  authMethod: AuthMethod;
};

export type Credentials = { email: string; password: string };
export type Registration = Credentials & { name?: string };
