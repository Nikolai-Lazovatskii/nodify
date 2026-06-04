/**
 * Súbor: src/lang/LanguagePreference.tsx
 * Abstrakt: Spravuje jazykové nastavenie aplikácie a poskytuje preklady komponentom.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { AppLanguage, translations } from "./translations";

const STORAGE_KEY = "nodify:language-preference:v1";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (value: AppLanguage) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}

export function LanguagePreferenceProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) {
          return;
        }

        if (stored === "en" || stored === "sk") {
          setLanguageState(stored);
        }
      } catch {

      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: string, params?: Record<string, string | number>) => {
      const template =
        translations[language][key] ??
        translations.en[key] ??
        key;

      return interpolate(template, params);
    };

    return {
      language,
      setLanguage: async (nextValue) => {
        setLanguageState(nextValue);
        try {
          await AsyncStorage.setItem(STORAGE_KEY, nextValue);
        } catch {

        }
      },
      toggleLanguage: async () => {
        const nextValue: AppLanguage = language === "en" ? "sk" : "en";
        setLanguageState(nextValue);
        try {
          await AsyncStorage.setItem(STORAGE_KEY, nextValue);
        } catch {

        }
      },
      t,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguagePreference() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguagePreference must be used within LanguagePreferenceProvider");
  }

  return context;
}

export function useTranslation() {
  const { t } = useLanguagePreference();
  return { t };
}
