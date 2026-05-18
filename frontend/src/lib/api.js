import axios from 'axios';

const TOKEN_KEY = 'rk.jwt';
const ROLE_KEY = 'rk.role';
const USER_KEY = 'rk.user_id';

export const tokenStore = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  get role() {
    return localStorage.getItem(ROLE_KEY) || '';
  },
  get userId() {
    return localStorage.getItem(USER_KEY) || '';
  },
  set({ token, role, user_id }) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (role) localStorage.setItem(ROLE_KEY, role);
    if (user_id) localStorage.setItem(USER_KEY, user_id);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

// In dev we proxy /auth, /donors, etc through Vite. In production builds the
// API base must be set via VITE_API_URL.
const baseURL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const t = tokenStore.token;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Spec §7: 401 → redirect to login. We dispatch a CustomEvent so a top-level
// listener can do navigation without coupling axios to react-router.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent('rk:auth-expired'));
    }
    return Promise.reject(err);
  },
);

// Helper that strips the axios envelope so callers see a plain object.
export async function apiRequest(method, url, body) {
  const r = await api.request({ method, url, data: body });
  return r.data;
}
