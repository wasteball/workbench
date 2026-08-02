import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AppRoute {
  page: string;
  params: URLSearchParams;
}

function readRoute(): AppRoute {
  const raw = window.location.hash.replace(/^#\/?/, '') || 'home';
  const [page = 'home', query = ''] = raw.split('?');
  return { page, params: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = useCallback((page: string, params?: URLSearchParams) => {
    const query = params && [...params].length ? `?${params.toString()}` : '';
    window.location.hash = `${page}${query}`;
  }, []);

  return useMemo(() => ({ route, navigate }), [navigate, route]);
}
