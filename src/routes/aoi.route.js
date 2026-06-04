// src/routes/aoi.route.js
import { getAoiRegistry, YEAR_RANGE } from '../services/gee.service.js'

export default async function aoiRoute(fastify) {

  // GET /api/aoi — all locations grouped by geopolitical zone
  fastify.get('/aoi', async (request, reply) => {
    const locations = Object.entries(getAoiRegistry()).map(([key, meta]) => ({
      key,
      label:   meta.label,
      state:   meta.state,
      zone:    meta.zone   || 'Featured',
      center:  { lat: meta.lat, lng: meta.lng },
      bufferM: meta.bufferM,
    }))

    // Group by zone for the frontend grouped dropdown
    const zones = {}
    for (const loc of locations) {
      if (!zones[loc.zone]) zones[loc.zone] = []
      zones[loc.zone].push(loc)
    }

    return reply.send({
      locations,
      zones,
      yearRange: YEAR_RANGE,
      totalLocations: locations.length,
    })
  })

  // GET /api/aoi/:key — single location details
  fastify.get('/aoi/:key', async (request, reply) => {
    const { key } = request.params
    const meta    = getAoiRegistry()[key]
    if (!meta) {
      return reply.code(404).send({
        error: `AOI not found: "${key}"`,
        validKeys: Object.keys(getAoiRegistry()),
      })
    }
    return reply.send({ key, ...meta, yearRange: YEAR_RANGE })
  })
}