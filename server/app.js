// Joshua Nunez
const path = require('path');
const express = require('express');
const config = require('./config');
const mw = require('./middleware');
const apiRouter = require('./routes/api');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Only a proxy on this machine (such as a tunnel) is trusted to set X-Forwarded-*.
  app.set('trust proxy', 'loopback');
  app.use(mw.securityHeaders);
  app.use(express.json({ limit: '20kb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', mw.sessionLoader(db));
  app.use('/api', apiRouter(db));
  app.use('/api', mw.errorHandler);

  // "no-cache" means "check with the server before reusing" (cheap, thanks to ETags), so updates show up at once.
  app.use(express.static(path.join(config.root, 'public'), { etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.get('*', (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));
  return app;
}

module.exports = { createApp };
