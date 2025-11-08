const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export interface User {
  email: string;
  name: string;
  picture?: string;
}

class AuthService {
  private tokenKey = 'auth_token';
  private userKey = 'auth_user';

  async getGoogleLoginUrl(): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/api/auth/google/login-url`);
    if (!response.ok) {
      throw new Error('Failed to get login URL');
    }
    const data = await response.json();
    return data.auth_url;
  }

  async loginWithCode(code: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google/callback?code=${code}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Authentication failed');
      }
      const data = await response.json();
      this.setToken(data.access_token);
      this.setUser(data.user);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  async signInWithGoogle(): Promise<void> {
    try {
      const authUrl = await this.getGoogleLoginUrl();
      // Open OAuth flow in current window
      window.location.href = authUrl;
    } catch (error) {
      console.error('Failed to initiate Google login:', error);
      throw error;
    }
  }

  async getCurrentUser(): Promise<User | null> {
    const token = this.getToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        this.clearAuth();
        return null;
      }

      const user = await response.json();
      this.setUser(user);
      return user;
    } catch (error) {
      console.error('Failed to get current user:', error);
      this.clearAuth();
      return null;
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (error) {
        console.error('Logout request failed:', error);
      }
    }
    this.clearAuth();
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  setToken(token: string): void {
    localStorage.setItem(this.tokenKey, token);
  }

  getUser(): User | null {
    const userStr = localStorage.getItem(this.userKey);
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  setUser(user: User): void {
    localStorage.setItem(this.userKey, JSON.stringify(user));
  }

  clearAuth(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  // Get authorization header for API requests
  getAuthHeaders(): Record<string, string> {
    const token = this.getToken();
    if (token) {
      return {
        'Authorization': `Bearer ${token}`
      };
    }
    return {};
  }
}

export const authService = new AuthService();

