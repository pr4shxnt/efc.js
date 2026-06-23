import { ignite, gracefulShutdown } from 'express-file-cluster';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PORT, DATABASE_URL, JWT_SECRET, CORS_ORIGINS are read from .env automatically
ignite({
  apiDir: path.join(__dirname, 'api'),
  tasksDir: path.join(__dirname, 'tasks'),
  tasks: { backend: 'bullmq' },
})
  .then(gracefulShutdown)
  .catch(console.error);
