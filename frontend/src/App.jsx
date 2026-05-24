import { Routes, Route, Navigate } from 'react-router-dom';

import { Landing } from './pages/Landing.jsx';
import { DonorLogin } from './pages/donor/DonorLogin.jsx';
import { DonorRegister } from './pages/donor/DonorRegister.jsx';
import { DonorDashboard } from './pages/donor/DonorDashboard.jsx';
import { StaffLogin } from './pages/staff/StaffLogin.jsx';
import { CoordinatorPortal } from './pages/coordinator/CoordinatorPortal.jsx';
import { RequestDetail } from './pages/coordinator/RequestDetail.jsx';
import { HospitalPortal } from './pages/hospital/HospitalPortal.jsx';
import { BloodBankPortal } from './pages/bloodbank/BloodBankPortal.jsx';
import { AdminDashboard } from './pages/admin/AdminDashboard.jsx';
import { ReportsViewer } from './pages/admin/ReportsViewer.jsx';
import { InstitutionApply } from './pages/onboarding/InstitutionApply.jsx';
import { HostCamp } from './pages/camps/HostCamp.jsx';
import { CampOrganizerDashboard } from './pages/camps/CampOrganizerDashboard.jsx';
import { PublicCampPage } from './pages/camps/PublicCampPage.jsx';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy.jsx';
import { TermsOfService } from './pages/legal/TermsOfService.jsx';
import { DataDeletion } from './pages/legal/DataDeletion.jsx';
import { DhoDashboard } from './pages/dho/DhoDashboard.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { useAuth } from './auth/AuthContext.jsx';

function HomeRedirect() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Landing />;
  if (role === 'donor') return <Navigate to="/donor" replace />;
  if (role === 'coordinator') return <Navigate to="/coordinator" replace />;
  if (role === 'hospital') return <Navigate to="/hospital" replace />;
  if (role === 'blood_bank') return <Navigate to="/bb" replace />;
  if (role === 'ngo_admin' || role === 'super_admin') return <Navigate to="/admin" replace />;
  if (role === 'dho') return <Navigate to="/dho" replace />;
  // ngo_admin / blood_bank / super_admin still need their own dashboards;
  // Phase 7 starter sends them through the staff landing.
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<DonorLogin />} />
      <Route path="/register" element={<DonorRegister />} />
      <Route path="/staff/login" element={<StaffLogin />} />
      <Route path="/onboarding/apply" element={<InstitutionApply />} />
      <Route path="/camps/host" element={<HostCamp />} />
      <Route path="/camp/:token" element={<CampOrganizerDashboard />} />
      <Route path="/c/:slug" element={<PublicCampPage />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/data-deletion" element={<DataDeletion />} />

      <Route
        path="/donor"
        element={
          <RequireAuth roles={['donor']}>
            <DonorDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/coordinator"
        element={
          <RequireAuth roles={['coordinator', 'ngo_admin', 'super_admin']}>
            <CoordinatorPortal />
          </RequireAuth>
        }
      />
      <Route
        path="/coordinator/requests/:id"
        element={
          <RequireAuth roles={['coordinator', 'ngo_admin', 'super_admin']}>
            <RequestDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/hospital"
        element={
          <RequireAuth roles={['hospital']}>
            <HospitalPortal />
          </RequireAuth>
        }
      />
      <Route
        path="/bb"
        element={
          <RequireAuth roles={['blood_bank', 'ngo_admin', 'super_admin']}>
            <BloodBankPortal />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth roles={['ngo_admin', 'super_admin']}>
            <AdminDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <RequireAuth roles={['ngo_admin', 'super_admin', 'coordinator', 'blood_bank', 'dho']}>
            <ReportsViewer />
          </RequireAuth>
        }
      />
      <Route
        path="/dho"
        element={
          <RequireAuth roles={['dho', 'ngo_admin', 'super_admin']}>
            <DhoDashboard />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
