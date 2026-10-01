require('dotenv').config();
const express = require('express');
const cors = require('cors');
const musicRoutes = require('./routes/musicRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Configure CORS: Support FRONTEND_URL (can be comma-separated), *.vercel.app, and local dev
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = [
  ...envOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (
        allowedOrigins.indexOf(cleanOrigin) !== -1 ||
        cleanOrigin.endsWith('.vercel.app') ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(new Error('CORS policy: This origin is not allowed by Access-Control-Allow-Origin'));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});


app.get('/', (req, res) => {
  res.json({
    service: 'Music Streaming Backend API',
    version: '1.0.0',
    endpoints: {
      search: '/api/search?q=song_name',
      song: '/api/song?query=song_id_or_url',
      lyrics: '/api/lyrics?query=song_id_or_url',
      playlist: '/api/playlist?query=playlist_url',
      album: '/api/album?query=album_url',
      trending: '/api/trending',
    },
  });
});

// Mount music routes
app.use('/api', musicRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message || 'Something went wrong on the server',
  });
});

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🎵 Music API Backend running on port ${PORT}`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`===============================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use by another process.`);
      console.error(`👉 Terminate the occupying process or check task manager.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  const cleanup = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
}

module.exports = app;
