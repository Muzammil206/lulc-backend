// ============================================================
// src/server.js
// Entry point — boots Fastify, registers all routes,
// initialises Google Earth Engine, starts listening.
//
// Run with Bun:  bun --watch src/server.js
// Run with Node: node --watch src/server.js
// ============================================================

import 'dotenv/config'
import Fastify       from 'fastify'
import cors          from '@fastify/cors'

import { initGEE }           from './services/gee.service.js'
import { registerErrorHandler } from './middleware/errorHandler.js'
import healthRoute   from './routes/health.route.js'
import aoiRoute      from './routes/aoi.route.js'
import classifyRoute from './routes/classify.route.js'
import tilesRoute    from './routes/tiles.route.js'

// ── Create Fastify instance ──────────────────────────────────
const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',   // readable logs in development
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  },
})

// ── CORS ─────────────────────────────────────────────────────
// Allow requests from the Next.js frontend
await fastify.register(cors, {
  origin: [
    process.env.FRONTEND_URL ||  'http://localhost:3000',
    // Add your production Vercel URL here when deployed:
    // 'https://your-lulc-app.vercel.app',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
})

// ── Error handler ─────────────────────────────────────────────
registerErrorHandler(fastify)

// ── Routes ───────────────────────────────────────────────────
// /health — no prefix
await fastify.register(healthRoute)

// /api/* — all data routes
await fastify.register(aoiRoute,      { prefix: '/api' })
await fastify.register(classifyRoute, { prefix: '/api' })
await fastify.register(tilesRoute,    { prefix: '/api' })

// ── Boot sequence ─────────────────────────────────────────────
async function start() {
  try {
    // Step 1: Initialise GEE with service account
    // This must complete before any route can serve classification data
    console.log('Initialising Google Earth Engine...')
    await initGEE()

    // Step 2: Start HTTP server
    const port = Number(process.env.PORT || 3001)
    const host = process.env.HOST || '0.0.0.0'

    await fastify.listen({ port, host })

    console.log('')
    console.log('  ✓ LULC Backend running')
    console.log(`  ✓ http://localhost:${port}`)
    console.log('')
    console.log('  Available endpoints:')
    console.log(`  GET  http://localhost:${port}/health`)
    console.log(`  GET  http://localhost:${port}/api/aoi`)
    console.log(`  GET  http://localhost:${port}/api/classify?aoiKey=ogidi-ilorin-west&year1=2015&year2=2024`)
    console.log(`  GET  http://localhost:${port}/api/tiles/:mapId/:z/:x/:y?token=...`)
    console.log('')

  } catch (err) {
    console.error('Failed to start server:', err.message)
    console.error('')

    if (err.message.includes('key not found')) {
      console.error('ACTION NEEDED:')
      console.error('  1. Download your GEE service account key from Google Cloud Console')
      console.error('  2. Save it as gee-service-account.json in the project root')
      console.error('  3. Copy .env.example to .env and fill in your values')
    }

    process.exit(1)
  }
}

start()
