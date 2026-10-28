import express from 'express';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createApp } from './app.ts';
import { Store } from './store.ts';
const store = new Store();
const app = createApp(store);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    try {
      const html = await vite.transformIndexHtml(
        req.originalUrl,
        readFileSync(resolve('index.html'), 'utf-8'),
      );
      res.status(200).type('html').send(html);
    } catch (e) {
      next(e);
    }
  });
}
const port = Number(process.env.PORT || 4173),
  host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Freejira: http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      store.db.close();
      process.exit(0);
    }),
  );
