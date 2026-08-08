"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { adminModeUpdatedEvent, readAdminMode } from "@/data/adminMode";
import {
  authSessionUpdatedEvent,
  clearSession,
  readSession,
  sessionKey,
  writeSession,
  type StoredSession,
} from "@/lib/authStore";
import { restoreSessionFromCookie } from "@/lib/apiClient";

type AuthContextValue = {
  session: StoredSession | null;
  isAdmin: boolean;
  canEditContent: boolean;
  login: (session: StoredSession) => void;
  logout: () => void;
  refresh: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthSnapshot = {
  session: StoredSession | null;
  legacyAdminMode: boolean;
};

const serverSnapshot = JSON.stringify({ session: null, legacyAdminMode: false } satisfies AuthSnapshot);

function readAuthSnapshot() {
  return JSON.stringify({
    session: readSession(),
    legacyAdminMode: readAdminMode(),
  } satisfies AuthSnapshot);
}

function parseAuthSnapshot(snapshot: string): AuthSnapshot {
  try {
    return JSON.parse(snapshot) as AuthSnapshot;
  } catch {
    return { session: null, legacyAdminMode: false };
  }
}

function subscribeAuthSnapshot(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === sessionKey || event.key === null) onStoreChange();
  };

  window.addEventListener(authSessionUpdatedEvent, onStoreChange);
  window.addEventListener(adminModeUpdatedEvent, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(authSessionUpdatedEvent, onStoreChange);
    window.removeEventListener(adminModeUpdatedEvent, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const snapshot = useSyncExternalStore(subscribeAuthSnapshot, readAuthSnapshot, () => serverSnapshot);
  const { session, legacyAdminMode } = useMemo(() => parseAuthSnapshot(snapshot), [snapshot]);

  useEffect(() => {
    if (session) return;
    void restoreSessionFromCookie();
  }, [session]);

  const login = useCallback((nextSession: StoredSession) => {
    writeSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, []);

  const refresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent<StoredSession | null>(authSessionUpdatedEvent, { detail: readSession() }));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const isAdmin = session?.membership?.role === "owner" || legacyAdminMode;
    return {
      session,
      isAdmin,
      canEditContent: Boolean(session) || legacyAdminMode,
      login,
      logout,
      refresh,
    };
  }, [legacyAdminMode, login, logout, refresh, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
