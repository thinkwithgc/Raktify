import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { ScrollToTop } from './components/ScrollToTop.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { LangProvider } from './i18n/LangProvider.jsx';
import { queryClient } from './lib/queryClient.js';
import './index.css';

/**
 * Promote the Google Fonts stylesheet from media="print" to media="all".
 *
 * index.html requests it as a print stylesheet so the browser fetches it without
 * blocking first paint; something has to flip it once it lands. That flip was an
 * inline `onload=` attribute, which a `script-src 'self'` CSP blocks - inline
 * event handlers need 'unsafe-inline', which would defeat most of the point of
 * having a CSP. Doing it here keeps the stylesheet non-blocking AND the policy
 * tight.
 *
 * The `sheet` check is load-bearing: if the CSS arrived before this bundle ran,
 * the load event has already fired and will never fire again, so waiting for it
 * would leave the page in the fallback face forever.
 */
const fontLink = document.getElementById('rk-fonts');
if (fontLink) {
  if (fontLink.sheet) {
    fontLink.media = 'all';
  } else {
    fontLink.addEventListener('load', () => {
      fontLink.media = 'all';
    }, { once: true });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <LangProvider>
            <ScrollToTop />
            <App />
          </LangProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
