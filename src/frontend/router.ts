import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import RootLayout from './layouts/RootLayout';
import BoardRoute from './routes/BoardRoute';
import HomeRoute from './routes/HomeRoute';
import MockupRoute from './routes/MockupRoute';
import SeedsRoute from './routes/SeedsRoute';
import TaskDetailRoute from './routes/TaskDetailRoute';
import TaskPageRoute from './routes/TaskPageRoute';

const rootRoute = createRootRoute({ component: RootLayout });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/repos/$repoId',
  component: BoardRoute,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => boardRoute,
  path: '/tasks/$taskId',
  component: TaskDetailRoute,
});

const taskPageRoute = createRoute({
  getParentRoute: () => taskDetailRoute,
  path: '/page',
  component: TaskPageRoute,
});

const seedsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/seeds',
  component: SeedsRoute,
});

const mockupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mockups',
  component: MockupRoute,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  boardRoute.addChildren([taskDetailRoute.addChildren([taskPageRoute])]),
  seedsRoute,
  mockupRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
