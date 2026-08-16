import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { ApiError, authApi } from "../lib/api";
import type { LoginResult, Member } from "../types";

interface AuthContextValue {
  member: Member | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_MARKER_KEY = "sahl:active-session";

export function AuthProvider({ children }: PropsWithChildren) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const handleSessionExpired = () => {
      // A 401 on a first visit only means that the visitor is not signed in.
      // Show an expiry message only when this browser had an active Sahl session.
      if (!sessionStorage.getItem(SESSION_MARKER_KEY)) return;

      sessionStorage.removeItem(SESSION_MARKER_KEY);
      setMember(null);
      setSessionExpired(true);
    };

    window.addEventListener("sahl:session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("sahl:session-expired", handleSessionExpired);
    };
  }, []);

  useEffect(() => {
    let active = true;

    authApi
      .me()
      .then((currentMember) => {
        if (active) setMember(currentMember);
      })
      .catch((error: unknown) => {
        if (!active) return;

        const hadActiveSession = Boolean(
          sessionStorage.getItem(SESSION_MARKER_KEY)
        );
        setMember(null);

        // This covers a real expiry after a browser refresh. A missing cookie
        // on a normal first visit stays quiet.
        if (hadActiveSession && error instanceof ApiError && error.status === 401) {
          sessionStorage.removeItem(SESSION_MARKER_KEY);
          setSessionExpired(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await authApi.login(identifier, password);
    sessionStorage.setItem(SESSION_MARKER_KEY, "true");
    setMember(result.member);
    setSessionExpired(false);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    sessionStorage.removeItem(SESSION_MARKER_KEY);
    setMember(null);
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({ member, loading, sessionExpired, login, logout }),
    [member, loading, sessionExpired, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
