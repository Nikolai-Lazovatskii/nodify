import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ColorSchemeName, useColorScheme as useNativeColorScheme } from "react-native";

const STORAGE_KEY = "nodify:theme-preference:v1";

type ThemePreferenceContextValue = {
  colorScheme: "light" | "dark";
  preference: "light" | "dark" | null;
  setPreference: (value: "light" | "dark" | null) => Promise<void>;
  togglePreference: () => Promise<void>;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const nativeColorScheme = useNativeColorScheme();
  const [preference, setPreferenceState] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) {
          return;
        }

        if (stored === "light" || stored === "dark") {
          setPreferenceState(stored);
        }
      } catch {
        // Ignore storage failures and fall back to the device theme.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const colorScheme: "light" | "dark" =
    preference ?? ((nativeColorScheme as ColorSchemeName) === "dark" ? "dark" : "light");

  const value = useMemo<ThemePreferenceContextValue>(() => {
    return {
      colorScheme,
      preference,
      setPreference: async (nextValue) => {
        setPreferenceState(nextValue);
        try {
          if (nextValue) {
            await AsyncStorage.setItem(STORAGE_KEY, nextValue);
          } else {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          // Ignore persistence failures; runtime preference still updates.
        }
      },
      togglePreference: async () => {
        const nextValue = colorScheme === "dark" ? "light" : "dark";
        setPreferenceState(nextValue);
        try {
          await AsyncStorage.setItem(STORAGE_KEY, nextValue);
        } catch {
          // Ignore persistence failures; runtime preference still updates.
        }
      },
    };
  }, [colorScheme, preference]);

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemePreferenceProvider");
  }

  return context;
}
