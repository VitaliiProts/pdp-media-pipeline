import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enApiKeys from '../locales/en/apiKeys.json';
import enAssets from '../locales/en/assets.json';
import enAuth from '../locales/en/auth.json';
import enJobs from '../locales/en/jobs.json';
import enSettings from '../locales/en/settings.json';
import enShell from '../locales/en/shell.json';
import enUpload from '../locales/en/upload.json';
import enWebhooks from '../locales/en/webhooks.json';
import enWorkspace from '../locales/en/workspace.json';
import ukApiKeys from '../locales/uk/apiKeys.json';
import ukAssets from '../locales/uk/assets.json';
import ukAuth from '../locales/uk/auth.json';
import ukJobs from '../locales/uk/jobs.json';
import ukSettings from '../locales/uk/settings.json';
import ukShell from '../locales/uk/shell.json';
import ukUpload from '../locales/uk/upload.json';
import ukWebhooks from '../locales/uk/webhooks.json';
import ukWorkspace from '../locales/uk/workspace.json';
import { safeStorage } from '../shared/lib/safe-storage';

export const resources = {
  en: {
    apiKeys: enApiKeys,
    assets: enAssets,
    auth: enAuth,
    jobs: enJobs,
    settings: enSettings,
    shell: enShell,
    upload: enUpload,
    webhooks: enWebhooks,
    workspace: enWorkspace,
  },
  uk: {
    apiKeys: ukApiKeys,
    assets: ukAssets,
    auth: ukAuth,
    jobs: ukJobs,
    settings: ukSettings,
    shell: ukShell,
    upload: ukUpload,
    webhooks: ukWebhooks,
    workspace: ukWorkspace,
  },
} as const;

export type Language = keyof typeof resources;

/** Prerendered pages are built in it, and a visitor who never picked a language gets it. */
export const DEFAULT_LANGUAGE: Language = 'en';

const LANGUAGE_STORAGE_KEY = 'pdp.language';

const isLanguage = (value: string | null): value is Language =>
  value !== null && Object.hasOwn(resources, value);

/** The language the visitor picked earlier, if any. Reads site storage: browser only. */
export function storedLanguage(): Language | null {
  const stored = safeStorage.get(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : null;
}

/** Touches no browser API until the language changes, so the server renders with it too. */
export function initI18n(language: Language = DEFAULT_LANGUAGE) {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    ns: [
      'workspace',
      'jobs',
      'upload',
      'webhooks',
      'auth',
      'assets',
      'settings',
      'apiKeys',
      'shell',
    ],
    defaultNS: 'workspace',
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  instance.on('languageChanged', (lng) => {
    safeStorage.set(LANGUAGE_STORAGE_KEY, lng);
    document.documentElement.lang = lng;
  });
  return instance;
}
