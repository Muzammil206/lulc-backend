// ============================================================
// src/routes/tiles.route.js
//
// GET /api/tiles/:z/:x/:y?url=ENCODED_GEE_TILE_URL
//
// Modern GEE SDK returns urlFormat like:
//   https://earthengine.googleapis.com/v1/projects/.../maps/.../tiles/{z}/{x}/{y}
//
// MapLibre substitutes {z}/{x}/{y} before calling our proxy.
// We receive the full resolved GEE URL as query param `url`,
// fetch it server-side, and stream the PNG back.
// ============================================================

import fetch from 'node-fetch'

export default async function tilesRoute(fastify) {

  fastify.get('/tiles/:z/:x/:y', {
    schema: {
      params: {
        type: 'object',
        required: ['z', 'x', 'y'],
        properties: {
          z: { type: 'string', pattern: '^\\d+$' },
          x: { type: 'string', pattern: '^\\d+$' },
          y: { type: 'string', pattern: '^\\d+$' },
        },
      },
      querystring: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { z, x, y } = request.params
    const { url }     = request.query

    if (!url) {
      return reply.code(400).send({ error: '`url` query param required' })
    }

    let geeUrl
    try { geeUrl = decodeURIComponent(url) }
    catch { return reply.code(400).send({ error: 'Invalid url encoding' }) }

    // CRITICAL: The urlFormat still contains literal {z}/{x}/{y} placeholders
    // because encodeURIComponent encodes the braces so MapLibre only substitutes
    // them in the PATH portion, not inside the encoded query param value.
    // We must substitute them here using the actual path params.
    geeUrl = geeUrl
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      // Also handle URL-encoded brace variants just in case
      .replace('%7Bz%7D', z)
      .replace('%7Bx%7D', x)
      .replace('%7By%7D', y)

    // Safety — only proxy earthengine.googleapis.com
    if (!geeUrl.startsWith('https://earthengine.googleapis.com')) {
      fastify.log.warn(`Rejected non-GEE url: ${geeUrl.slice(0,60)}`)
      return reply.code(403).send({ error: 'URL not allowed' })
    }

    fastify.log.debug(`Tile ${z}/${x}/${y}`)

    try {
      const upstream = await fetch(geeUrl, {
        headers: { 'User-Agent': 'LULC-Dashboard/1.0' },
      })

      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '')
        fastify.log.warn(`GEE ${upstream.status} z=${z} x=${x} y=${y}: ${body.slice(0,200)}`)
        return reply.code(upstream.status).send({ error: 'GEE tile failed', status: upstream.status })
      }

      const buffer = await upstream.arrayBuffer()

      return reply
        .code(200)
        .header('Content-Type', upstream.headers.get('content-type') || 'image/png')
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Allow-Origin', '*')
        .send(Buffer.from(buffer))

    } catch (err) {
      fastify.log.error(`Tile proxy error: ${err.message}`)
      return reply.code(502).send({ error: 'Tile fetch failed', message: err.message })
    }
  })
}