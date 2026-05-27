import en from "./locales/en.json";
import es from "./locales/es.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LOCALES = ["ru", "en", "es", "zh"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationKey = keyof typeof en;

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  ru,
  en,
  es,
  zh
};

export function createTranslator(locale: Locale) {
  return (key: TranslationKey | string) => {
    const typedKey = key as TranslationKey;
    return dictionaries[locale][typedKey] ?? dictionaries.en[typedKey] ?? key;
  };
}

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}
