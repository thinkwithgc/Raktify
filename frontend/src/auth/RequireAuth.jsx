import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function RequireAuth({ roles, children }) {
  const { isAuthenticated, role } = useAuth();
  const loc = useLocation();

  if (!isAuthenticated) {
    // Send to the landing page (not the donor mobile-login) so logout / a
    // expired session lets the user re-pick how to sign in — mobile or staff.
    return <Navigate to="/" state={{ from: loc.pathname }} replace />;
  }
  if (roles && !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
