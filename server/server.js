import dns from 'node:dns';

// Fix for mobile hotspot DNS blocking MongoDB Atlas SRV lookups
dns.setServers(['8.8.8.8', '8.8.4.4']);

import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { connectDB } from './config/db.js';

// Route imports
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import creatorRoutes from './routes/creators.js';
import seriesRoutes from './routes/series.js';
import episodeRoutes from './routes/episodes.js';
import walletRoutes from './routes/wallet.js';
import vipRoutes from './routes/vip.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import adsRoutes from './routes/ads.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/upload.js';
import paymentRoutes from './routes/payment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Fastify
const fastify = Fastify({
  logger: true,
  bodyLimit: 104857600, // 100MB for uploads
});

// Register plugins
await fastify.register(fastifyCookie);
await fastify.register(fastifyCors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
});
await fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 104857600, // 100MB
  },
});

// Serve static files from /public
await fastify.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

// Health check route
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register API routes
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(userRoutes, { prefix: '/api/users' });
fastify.register(creatorRoutes, { prefix: '/api/creators' });
fastify.register(seriesRoutes, { prefix: '/api/series' });
fastify.register(episodeRoutes, { prefix: '/api/episodes' });
fastify.register(walletRoutes, { prefix: '/api/wallet' });
fastify.register(vipRoutes, { prefix: '/api/vip' });
fastify.register(commentRoutes, { prefix: '/api/comments' });
fastify.register(notificationRoutes, { prefix: '/api/notifications' });
fastify.register(searchRoutes, { prefix: '/api/search' });
fastify.register(adsRoutes, { prefix: '/api/ads' });
fastify.register(adminRoutes, { prefix: '/api/admin' });
fastify.register(uploadRoutes, { prefix: '/api/upload' });
fastify.register(paymentRoutes, { prefix: '/api/payment' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.statusCode = error.statusCode || 500;
  reply.send({
    success: false,
    message: error.message || 'Internal server error',
    statusCode: error.statusCode || 500,
  });
});

// Start server
const start = async () => {
  try {
    await connectDB();
    fastify.log.info('MongoDB connected successfully');

    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 AFROSTORY Backend running on port ${port}`);
  } catch (error) {
    fastify.log.error('Startup failed:', error);
    process.exit(1);
  }
};

start();

export default fastify;