/**
 * Súbor: src/lib/supabase.ts
 * Abstrakt: Konfiguruje klienta Supabase a perzistentné úložisko relácie.
 */
import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

type ExpoConstantsWithManifest = typeof Constants & {
  manifest2?: {
    extra?: Record<string, unknown>;
  };
};

const constantsWithManifest = Constants as ExpoConstantsWithManifest;
const extra = (Constants.expoConfig?.extra ?? constantsWithManifest.manifest2?.extra) as
  | Record<string, unknown>
  | undefined;

const supabaseUrl =
  typeof extra?.supabaseUrl === "string"
    ? extra.supabaseUrl
    : process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  typeof extra?.supabaseAnonKey === "string"
    ? extra.supabaseAnonKey
    : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env: supabaseUrl/supabaseAnonKey (app config extra) or EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY"
  );
}

const webStorage = {
  getItem: async (key: string) => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      return;
    }
  },
  removeItem: async (key: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      return;
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === "web" ? webStorage : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
