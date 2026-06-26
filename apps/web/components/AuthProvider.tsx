'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@campusly/shared-types';
import { authApi } from '../lib/auth';

/**
 * Auth context (AUTH_SYSTEM.md). Holds the current user and exposes login/logout.
 * On mount it attempts to restore the session via the persisted refresh token.
 */
interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  loginWithGoogle: (credential: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const current = await authApi.me();
    setUser(current);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const loggedIn = await authApi.loginWithGoogle(credential);
    setUser(loggedIn);
    return loggedIn;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, loginWithGoogle, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
