// ============================================================
// src/routes/aoi.route.js
// GET /api/aoi — returns all available AOI options
// GET /api/aoi/:key — returns one AOI's metadata
//
// The frontend calls /api/aoi on load to populate the
// location dropdown dynamically. Add locations to
// AOI_REGISTRY in gee.service.js and they appear automatically.
// ============================================================

import { AOI_REGISTRY, YEAR_RANGE } from '../services/gee.service.js'

export default async function aoiRoute(fastify) {

  // Return all available AOIs + year range config
  fastify.get('/aoi', async (request, reply) => {
    const locations = Object.entries(AOI_REGISTRY).map(([key, meta]) => ({
      key,
      label:   meta.label,
      state:   meta.state,
      center:  { lat: meta.lat, lng: meta.lng },
      bufferM: meta.bufferM,
    }))

    return reply.send({
      locations,
      yearRange: YEAR_RANGE,
      totalLocations: locations.length,
    })
  })

  // Return one AOI by key
  fastify.get('/aoi/:key', async (request, reply) => {
    const { key } = request.params
    const meta    = AOI_REGISTRY[key]

    if (!meta) {
      return reply.code(404).send({
        error: `AOI not found: "${key}"`,
        validKeys: Object.keys(AOI_REGISTRY),
      })
    }

    return reply.send({ key, ...meta, yearRange: YEAR_RANGE })
  })
}
