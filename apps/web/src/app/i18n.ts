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

const LANGUAGE_STORAGE_KEY = 'pdp.language';

function initialLanguage(): string {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && stored in resources) return stored;
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'uk';
}

export function initI18n(language = initialLanguage()) {
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
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = language;
  return instance;
}
