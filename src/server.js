// ============================================================
// src/server.js — Fastify server entry point
// ============================================================
import 'dotenv/config'
import Fastify    from 'fastify'
import cors       from '@fastify/cors'

import { initGEE }              from './services/gee.service.js'
import { registerErrorHandler } from './middleware/errorHandler.js'
import healthRoute      from './routes/health.route.js'
import aoiRoute         from './routes/aoi.route.js'
import classifyRoute    from './routes/classify.route.js'
import tilesRoute       from './routes/tiles.route.js'
import timeseriesRoute  from './routes/timeseries.route.js'
import exportRoute      from './routes/export.route.js'
import statsRoute       from './routes/stats.route.js'

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  },
})

await fastify.register(cors, {
  origin: [
    process.env.FRONTEND_URL,
    // Add your production Vercel URL here when deployed:
    'https://lulc.naviss.tech/'


  ],
  methods: ['GET', 'POST', 'OPTIONS'],
})

registerErrorHandler(fastify)

await fastify.register(healthRoute)
await fastify.register(aoiRoute,        { prefix: '/api' })
await fastify.register(classifyRoute,   { prefix: '/api' })
await fastify.register(tilesRoute,      { prefix: '/api' })
await fastify.register(timeseriesRoute, { prefix: '/api' })
await fastify.register(exportRoute,     { prefix: '/api' })
await fastify.register(statsRoute,      { prefix: '/api' })

async function start() {
  try {
    console.log('Initialising Google Earth Engine…')
    await initGEE()

    const port = Number(process.env.PORT || 3001)
    const host = process.env.HOST || '0.0.0.0'
    await fastify.listen({ port, host })

    console.log('')
    console.log('  ✓ LULC Backend running')
    console.log(`  ✓ http://localhost:${port}`)
    console.log('')
    console.log('  Endpoints:')
    console.log(`  GET  /health`)
    console.log(`  GET  /api/aoi`)
    console.log(`  GET  /api/classify?aoiKey=&year1=&year2=`)
    console.log(`  GET  /api/timeseries?aoiKey=&startYear=&endYear=`)
    console.log(`  POST /api/export`)
    console.log(`  GET  /api/export/:id`)
    console.log(`  GET  /api/stats/national?year1=&year2=`)
    console.log(`  GET  /api/tiles/:z/:x/:y?url=`)
    console.log('')
  } catch (err) {
    console.error('Failed to start:', err.message)
    process.exit(1)
  }
}

start()