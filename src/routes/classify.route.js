// ============================================================
// src/routes/classify.route.js
// POST /api/classify
// GET  /api/classify?aoiKey=...&year1=...&year2=...
//
// Accepts AOI key + two years, returns tile URLs + area stats.
// Results are cached for CACHE_TTL_SECONDS to avoid re-running
// expensive GEE computations on repeated requests.
// ============================================================

import { classifyLULC, getAoiRegistry, YEAR_RANGE } from '../services/gee.service.js'
import { makeCacheKey, cacheGet, cacheSet }        from '../services/cache.service.js'

export default async function classifyRoute(fastify) {

  // ── GET /api/classify ──────────────────────────────────────
  // Query params: aoiKey, year1, year2
  // Example: GET /api/classify?aoiKey=ogidi-ilorin-west&year1=2015&year2=2024
  fastify.get('/classify', {
    schema: {
      querystring: {
        type: 'object',
        required: ['aoiKey', 'year1', 'year2'],
        properties: {
          aoiKey: { type: 'string' },
          year1:  { type: 'string', pattern: '^\\d{4}$' },
          year2:  { type: 'string', pattern: '^\\d{4}$' },
          bust:   { type: 'string' }, // pass bust=1 to bypass cache
        },
      },
    },
  }, async (request, reply) => {
    const { aoiKey, year1: y1str, year2: y2str, bust } = request.query

    const year1 = parseInt(y1str, 10)
    const year2 = parseInt(y2str, 10)

    // ── Validation ─────────────────────────────────────────
    if (year1 === year2) {
      return reply.code(400).send({
        error: 'year1 and year2 must be different',
      })
    }

    if (year1 < YEAR_RANGE.min || year2 < YEAR_RANGE.min ||
        year1 > YEAR_RANGE.max || year2 > YEAR_RANGE.max) {
      return reply.code(400).send({
        error: `Years must be between ${YEAR_RANGE.min} and ${YEAR_RANGE.max}`,
      })
    }

    if (!getAoiRegistry()[aoiKey]) {
      return reply.code(400).send({
        error: `Unknown aoiKey: "${aoiKey}"`,
        validKeys: Object.keys(getAoiRegistry()),
      })
    }

    // ── Cache check ────────────────────────────────────────
    const cacheKey = makeCacheKey({ aoiKey, year1, year2 })

    if (!bust) {
      const cached = cacheGet(cacheKey)
      if (cached) {
        fastify.log.info(`Cache hit: ${cacheKey}`)
        return reply.send({ ...cached, cached: true })
      }
    }

    // ── Run GEE classification ─────────────────────────────
    fastify.log.info(`Running GEE classification: ${cacheKey}`)
    const startMs = Date.now()

    try {
      const result = await classifyLULC({ aoiKey, year1, year2 })
      const durationMs = Date.now() - startMs

      const response = {
        ...result,
        cached:     false,
        durationMs,
        computedAt: new Date().toISOString(),
      }

      // Cache the result
      cacheSet(cacheKey, response)

      fastify.log.info(`Classification done in ${durationMs}ms — cached as ${cacheKey}`)
      return reply.send(response)

    } catch (err) {
      fastify.log.error(`GEE classification error: ${err.message}`)
      return reply.code(500).send({
        error: 'GEE classification failed',
        message: err.message,
      })
    }
  })

  // ── POST /api/classify ─────────────────────────────────────
  // Same logic but accepts JSON body instead of query params
  // Useful for future frontend extensions
  fastify.post('/classify', async (request, reply) => {
    const { aoiKey, year1, year2, bust } = request.body || {}

    if (!aoiKey || !year1 || !year2) {
      return reply.code(400).send({
        error: 'Request body must include: aoiKey, year1, year2',
      })
    }

    // Delegate to GET handler logic by building a fake query
    return fastify.inject({
      method:  'GET',
      url:     `/api/classify?aoiKey=${aoiKey}&year1=${year1}&year2=${year2}${bust ? '&bust=1' : ''}`,
    }).then(res => reply.code(res.statusCode).send(JSON.parse(res.body)))
  })
}
