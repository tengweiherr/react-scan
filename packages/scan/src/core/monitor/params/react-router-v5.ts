import { createElement } from 'react';
import { useRouteMatch, useLocation } from 'react-router';
import { BaseMonitor } from '..';
import { computeRoute } from './utils';
import type { RouteInfo } from './types';

const useRoute = (): RouteInfo => {
  const match = useRouteMatch();
  const { pathname } = useLocation();
  const params = match?.params || {};

  if (!params) {
    return { route: null, path: pathname };
  }

  return {
    route: computeRoute(pathname, params),
    path: pathname,
  };
};

function ReactRouterV5Monitor(props: { url?: string; apiKey: string }) {
  const { route, path } = useRoute();
  return createElement(BaseMonitor, {
    ...props,
    route,
    path,
  });
}

export { ReactRouterV5Monitor as Monitoring };
