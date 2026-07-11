import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Reset the window scroll to the top on every route change.
 *
 * React Router does not restore/reset scroll by default, so navigating between
 * SPA pages otherwise keeps the previous scroll offset — e.g. clicking a footer
 * link while scrolled to the bottom lands you at the bottom of the new page.
 * Keyed on `pathname` only (not `search`), so in-page tab/query changes that
 * keep the same route don't yank the user back to the top.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
