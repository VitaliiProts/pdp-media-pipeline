import { type RouteObject } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { AppRoot } from './layouts/AppRoot';
import { PublicLayout } from './layouts/PublicLayout';
import { RequireAuth } from './layouts/RequireAuth';
import { RouteError } from './layouts/RouteError';
import { RouteFallback } from './layouts/RouteFallback';

/** Pages are lazy chunks; layouts ship in the main bundle. Shared by the app and the tests. */
export const routes: RouteObject[] = [
  {
    Component: AppRoot,
    HydrateFallback: RouteFallback,
    ErrorBoundary: RouteError,
    children: [
      {
        Component: PublicLayout,
        children: [
          {
            index: true,
            lazy: () =>
              import('../pages/landing/LandingPage').then((m) => ({ Component: m.LandingPage })),
          },
          {
            path: 'login',
            lazy: () =>
              import('../pages/login/LoginPage').then((m) => ({ Component: m.LoginPage })),
          },
          {
            path: 'register',
            lazy: () =>
              import('../pages/register/RegisterPage').then((m) => ({ Component: m.RegisterPage })),
          },
          {
            path: '*',
            lazy: () =>
              import('../pages/not-found/NotFoundPage').then((m) => ({
                Component: m.NotFoundPage,
              })),
          },
        ],
      },
      {
        Component: RequireAuth,
        children: [
          {
            Component: AppLayout,
            children: [
              {
                path: 'library',
                lazy: () =>
                  import('../pages/library/LibraryPage').then((m) => ({
                    Component: m.LibraryPage,
                  })),
              },
              {
                path: 'library/:assetId',
                lazy: () =>
                  import('../pages/asset/AssetPage').then((m) => ({ Component: m.AssetPage })),
              },
              {
                path: 'jobs',
                lazy: () =>
                  import('../pages/jobs/JobsPage').then((m) => ({ Component: m.JobsPage })),
              },
              {
                path: 'webhooks',
                lazy: () =>
                  import('../pages/webhooks/WebhooksPage').then((m) => ({
                    Component: m.WebhooksPage,
                  })),
              },
              {
                path: 'settings',
                lazy: () =>
                  import('../pages/settings/SettingsPage').then((m) => ({
                    Component: m.SettingsPage,
                  })),
              },
            ],
          },
        ],
      },
    ],
  },
];
