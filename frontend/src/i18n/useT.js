import { useCallback, useEffect, useMemo, useState } from 'react';
import { detectInitialLang, setLang as persistLang, SUPPORTED, tFor } from './strings.js';

export function useT() {
  const [lang, setLangState] = useState(() => {
    const initial = detectInitialLang();
    persistLang(initial);
    return initial;
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useMemo(() => tFor(lang), [lang]);

  const setLang = useCallback((next) => {
    persistLang(next);
    setLangState(next);
  }, []);

  return { t, lang, setLang, supported: SUPPORTED };
}
