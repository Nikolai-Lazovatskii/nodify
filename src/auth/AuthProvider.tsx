/**
 * Súbor: src/auth/AuthProvider.tsx
 * Abstrakt: Poskytuje autentifikačný stav, operácie účtu a automatickú synchronizáciu máp.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { listLocalMaps } from "../storage/mapsRepo";
import { syncMapsOnce, type SyncConflictResolution } from "../storage/syncMaps";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  syncing: boolean;
  isOnline: boolean;
  syncError: string | null;
  pendingSyncCount: number;
  lastSyncAt: number | null;
  syncNow: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown sync error");
}

function resolveSyncConflict(): Promise<SyncConflictResolution> {
  return new Promise((resolve) => {
    Alert.alert(
      "Konflikt synchronizácie",
      "Táto mapa bola upravená na inom zariadení aj lokálne. Ktorú verziu chcete zachovať?",
      [
        { text: "Táto verzia", onPress: () => resolve("local") },
        { text: "Verzia z cloudu", onPress: () => resolve("cloud") },
      ],
      { cancelable: false }
    );
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const syncingRef = useRef(false);

  const refreshPendingSyncCount = useCallback(async () => {
    try {
      const localMaps = await listLocalMaps();
      setPendingSyncCount(localMaps.filter((item) => item.pendingSyncAt != null).length);
    } catch {
      setPendingSyncCount(0);
    }
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setPendingSyncCount(0);
        return;
      }

      await syncMapsOnce({ resolveConflict: resolveSyncConflict });
      setIsOnline(true);
      setSyncError(null);
      setLastSyncAt(Date.now());
    } catch (error) {
      setIsOnline(false);
      setSyncError(getErrorMessage(error));
    } finally {
      await refreshPendingSyncCount();
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPendingSyncCount]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setSession(null);
          setIsOnline(false);
          setSyncError(getErrorMessage(error));
        } else {
          setSession(data.session ?? null);
          if (data.session) {
            void runSync();
          } else {
            setPendingSyncCount(0);
          }
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setSession(null);
        setIsOnline(false);
        setSyncError(getErrorMessage(error));
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);

      if (nextSession) {
        void runSync();
      } else {
        setPendingSyncCount(0);
        setSyncError(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [runSync]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void runSync();
      }
    });

    return () => subscription.remove();
  }, [runSync, session]);

  useEffect(() => {
    if (!session || isOnline) {
      return;
    }

    const timer = setInterval(() => {
      void runSync();
    }, 10000);

    return () => clearInterval(timer);
  }, [isOnline, runSync, session]);

  const value = useMemo<AuthState>(() => {
    return {
      session,
      user: session?.user ?? null,
      loading,
      syncing,
      isOnline,
      syncError,
      pendingSyncCount,
      lastSyncAt,
      syncNow: runSync,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
      changePassword: async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
    };
  }, [isOnline, lastSyncAt, pendingSyncCount, runSync, session, loading, syncError, syncing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
