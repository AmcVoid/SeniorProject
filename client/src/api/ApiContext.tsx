import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApiClient, type ApiClient } from './client.ts';
import type { UserIdentity } from '../types.ts';

export interface SessionState {
  token: string | null;
  identity: UserIdentity | null;
  expiresAt?: string | null;
}

export interface ApiContextValue {
  client: ApiClient;
  token: string | null;
  identity: UserIdentity | null;
  isAuthenticated: boolean;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  login: (credentials: { identifier: string; password: string }) => Promise<SessionState>;
  logout: () => void;
  setToken: (token: string | null) => void;
}

const ApiContext = createContext<ApiContextValue | null>(null);

const SESSION_STORAGE_KEY = 'mms.session';

interface InitialSessionResult {
  session: SessionState;
  expired: boolean;
}

function readInitialSession(): InitialSessionResult {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.token) {
          if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            return {
              session: { token: null, identity: null, expiresAt: null },
              expired: true,
            };
          }
          return {
            session: {
              token: parsed.token,
              identity: parsed.identity ?? null,
              expiresAt: parsed.expiresAt ?? null,
            },
            expired: false,
          };
        }
      }
    } catch {
      // Corrupt/unavailable storage
    }
  }

  const devToken =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.VITE_DEV_SESSION_TOKEN) ||
    null;
  return {
    session: { token: devToken, identity: null, expiresAt: null },
    expired: false,
  };
}

function persistSession(session: SessionState | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (session && session.token) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures
  }
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState<InitialSessionResult>(readInitialSession);
  const [session, setSession] = useState<SessionState>(initial.session);
  const [sessionExpired, setSessionExpired] = useState<boolean>(initial.expired);
  const { token, identity, expiresAt } = session;

  const navigate = useNavigate();

  const handleUnauthorized = useCallback(() => {
    persistSession(null);
    setSession({ token: null, identity: null, expiresAt: null });
    setSessionExpired(true);
    navigate('/', { replace: true });
  }, [navigate]);

  const client = useMemo(
    () =>
      createApiClient({
        getToken: () => token,
        onUnauthorized: handleUnauthorized,
      }),
    [token, handleUnauthorized],
  );

  // Proactive timer for session expiration
  useEffect(() => {
    if (!token || !expiresAt) return;
    const timeLeft = new Date(expiresAt).getTime() - Date.now();
    if (timeLeft <= 0) {
      handleUnauthorized();
      return;
    }
    const timer = setTimeout(() => {
      handleUnauthorized();
    }, timeLeft);
    return () => clearTimeout(timer);
  }, [token, expiresAt, handleUnauthorized]);

  // Proactive check when returning to tab/window
  useEffect(() => {
    if (!token || !expiresAt) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (new Date(expiresAt).getTime() <= Date.now()) {
          handleUnauthorized();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [token, expiresAt, handleUnauthorized]);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const value = useMemo<ApiContextValue>(() => {
    const login = async (credentials: { identifier: string; password: string }): Promise<SessionState> => {
      setSessionExpired(false);
      const { token: newToken, identity: newIdentity, expiresAt: newExpiresAt } = await client.login(credentials);
      const next: SessionState = {
        token: newToken,
        identity: newIdentity ?? null,
        expiresAt: newExpiresAt ?? null,
      };
      persistSession(next);
      setSession(next);
      return next;
    };

    const logout = (): void => {
      setSessionExpired(false);
      persistSession(null);
      setSession({ token: null, identity: null, expiresAt: null });
      navigate('/', { replace: true });
    };

    const setToken = (newToken: string | null): void => {
      const next: SessionState = {
        token: newToken ?? null,
        identity: newToken ? identity : null,
        expiresAt: newToken ? expiresAt : null,
      };
      persistSession(next.token ? next : null);
      setSession(next);
    };

    return {
      client,
      token,
      identity,
      isAuthenticated: Boolean(token),
      sessionExpired,
      clearSessionExpired,
      login,
      logout,
      setToken,
    };
  }, [client, token, identity, expiresAt, sessionExpired, clearSessionExpired, navigate]);

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within an <ApiProvider>');
  return ctx;
}

