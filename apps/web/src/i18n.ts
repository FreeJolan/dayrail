import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import enCommon from '@dayrail/locales/en/common';
import enRail from '@dayrail/locales/en/rail';
import zhCommon from '@dayrail/locales/zh-CN/common';
import zhRail from '@dayrail/locales/zh-CN/rail';

const detect = () => {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('dayrail.locale') : null;
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: detect(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'rail'],
    resources: {
      en: { common: enCommon, rail: enRail },
      'zh-CN': { common: zhCommon, rail: zhRail },
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
