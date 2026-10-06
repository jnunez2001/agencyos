// Joshua Nunez
const path = require('path');
const express = require('express');
const config = require('./config');
const mw = require('./middleware');
const apiRouter = require('./routes/api');
const { mcpHandler } = require('./mcp');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Only a proxy on this machine (such as a tunnel) is trusted to set X-Forwarded-*.
  app.set('trust proxy', 'loopback');
  app.use(mw.securityHeaders);
  // The AI endpoint takes bigger plans than the screens do. It needs a Bearer key, not a session.
  app.use('/mcp', express.json({ limit: '200kb' }), mcpHandler(db), (err, req, res, next) => res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
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
