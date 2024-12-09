import { createElement } from 'react';
import { useParams, useLocation } from '@remix-run/react';
import { BaseMonitor } from '..';
import { computeReactRouterRoute } from './utils';
import type { RouteInfo } from './types';

const useRoute = (): RouteInfo => {
  const params = useParams();
  const { pathname } = useLocation();

  if (!params || Object.keys(params).length === 0) {
    return { route: null, path: pathname };
  }

  const validParams = params as Record<string, string>;

  return {
    route: computeReactRouterRoute(pathname, validParams),
    path: pathname,
  };
};

function RemixMonitor(props: { url?: string; apiKey: string }) {
  const { route, path } = useRoute();
  return createElement(BaseMonitor, {
    ...props,
    route,
    path,
  });
}

export { RemixMonitor as Monitoring };
