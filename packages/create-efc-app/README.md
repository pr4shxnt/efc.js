# create-efc-app

**Interactive scaffolder for Express File Cluster projects.**

## Quick Start

```bash
npx create-efc-app my-api
cd my-api
efc start dev
```

The interactive scaffolder asks for language, database, auth strategy, and whether you want clustering and background tasks — then writes the boilerplate, generates a `.env` with a real `JWT_SECRET`, and runs `npm install`.

For full framework documentation on routing, middleware, clustering, and tasks, please see the [Express File Cluster](https://www.npmjs.com/package/express-file-cluster) package or the [GitHub Repository](https://github.com/pr4shxnt/efc.js).
