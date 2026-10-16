import { common } from './common';
import { settings } from './settings';

const resources = {
  en: {
    common: common.en,
    settings: settings.en
  },
  ru: {
    common: common.ru,
    settings: settings.ru
  }
};

export function t(locale, path) {
  const lang = resources[locale] ? locale : 'en';

  return path.split('.').reduce((obj, key) => {
    return obj?.[key];
  }, resources[lang]) || path;
}