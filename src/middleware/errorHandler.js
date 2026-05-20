// ============================================================
// src/middleware/errorHandler.js
// Global error handler — catches anything not caught by routes
// ============================================================

export function registerErrorHandler(fastify) {
  // Handle validation errors from Fastify schema
  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500

    // Log 5xx errors fully, 4xx just as warnings
    if (statusCode >= 500) {
      fastify.log.error({ err: error, url: request.url }, 'Server error')
    } else {
      fastify.log.warn({ err: error, url: request.url }, 'Client error')
    }

    reply.code(statusCode).send({
      error:      error.message || 'Internal server error',
      statusCode,
      path:       request.url,
      timestamp:  new Date().toISOString(),
    })
  })

  // Handle 404s
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error:     `Route not found: ${request.method} ${request.url}`,
      statusCode: 404,
      availableRoutes: [
        'GET  /health',
        'GET  /api/aoi',
        'GET  /api/aoi/:key',
        'GET  /api/classify?aoiKey=&year1=&year2=',
        'POST /api/classify',
        'GET  /api/tiles/:mapId/:z/:x/:y?token=',
      ],
    })
  })
}
