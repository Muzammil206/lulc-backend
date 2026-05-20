// ============================================================
// src/routes/health.route.js
// GET /health — server + GEE status check
// Used by Railway/Render deployment health checks
// and useful for debugging during development
// ============================================================

import { cacheStats } from '../services/cache.service.js'

export default async function healthRoute(fastify) {
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      status:    'ok',
      uptime:    Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      cache:     cacheStats(),
      env: {
        node:       process.version,
        geeKeyFile: process.env.GEE_KEY_FILE || './gee-service-account.json',
        port:       process.env.PORT || 3001,
      },
    })
  })
}
