import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/protected-route";
import { ClaimsPage } from "./pages/claims-page";
import { NewClaimPage } from "./pages/new-claim-page";
import { ClaimDocumentsPage } from "./pages/claim-documents-page";
import { LoginPage } from "./pages/login-page";
import { ClaimReviewPage } from "./pages/claim-review-page";
import { SubmittedClaimPage } from "./pages/submitted-claim-page";
import { OpsPage } from "./pages/ops-page";
import { PresenterTools } from "./components/demo-ops-launcher";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/claims" element={<ClaimsPage />} />
          <Route path="/claims/new" element={<NewClaimPage />} />
          <Route path="/claims/:claimId/details" element={<NewClaimPage />} />
          <Route path="/claims/:claimId/documents" element={<ClaimDocumentsPage />} />
          <Route path="/claims/:claimId/review" element={<ClaimReviewPage />} />
          <Route path="/claims/:claimId/submitted" element={<SubmittedClaimPage />} />
          <Route path="/ops" element={<OpsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/claims" replace />} />
      </Routes>
      <PresenterTools />
    </>
  );
}
