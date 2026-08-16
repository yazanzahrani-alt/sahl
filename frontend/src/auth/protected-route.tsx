import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { useLanguage } from "../i18n/language-context";

export function ProtectedRoute() {
  const { member, loading } = useAuth();
  const location = useLocation();
  const { isArabic } = useLanguage();

  if (loading) {
    return (
      <main className="sahl-app grid min-h-screen place-items-center bg-[#f4f7fb]">
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-[#dce6f0] border-t-[#005eb8]"
          role="status"
          aria-label={isArabic ? "جارٍ التحميل" : "Loading"}
        />
      </main>
    );
  }

  if (!member) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
