import type { AppRoute } from '@/app/use-route';

export interface PageProps {
  route: AppRoute;
  navigate: (page: string, params?: URLSearchParams) => void;
}
