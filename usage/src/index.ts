import { ignite, gracefulShutdown } from 'express-file-cluster';

// PORT, DATABASE_URL, JWT_SECRET, CORS_ORIGINS are read from .env automatically
ignite({
  cluster: true,
  workers: 2,
  basePath: '/',
  tasks: { backend: 'bullmq' },
  dashboard: true,
})
  .then(gracefulShutdown)
  .catch(console.error);
