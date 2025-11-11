import React, { createContext, useContext, useEffect, useState } from 'react';
import { AISchedulerService } from '../services/AISchedulerService';

interface AuthContextValue {
  user: any | null;
  token: string | null;
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  setToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [token, setTokenState] = useState<string | null>(localStorage.getItem('accessToken'));
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const setToken = (value: string | null) => {
    setTokenState(value);
    if (value) {
      localStorage.setItem('accessToken', value);
    } else {
      localStorage.removeItem('accessToken');
    }
    AISchedulerService.setAuthToken(value);
  };

  useEffect(() => {
    if (token) {
      AISchedulerService.setAuthToken(token);
      fetchCurrentUser();
    } else {
      setUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchCurrentUser = async () => {
    try {
      setIsLoading(true);
      const me = await AISchedulerService.getCurrentUser();
      setUser(me);
    } catch (error) {
      console.error('Failed to load current user', error);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const { auth_url } = await AISchedulerService.getGoogleAuthUrl(redirectUri);
    window.location.href = auth_url;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const value: AuthContextValue = {
    user,
    token,
    isLoading,
    loginWithGoogle,
    logout,
    setToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
