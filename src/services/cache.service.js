// ============================================================
// src/services/cache.service.js
// Simple in-memory cache with TTL (time-to-live).
// GEE computations take 5–15 seconds — caching is essential.
// The same AOI+year1+year2 combination returns instantly on
// the second request until the TTL expires.
// ============================================================

const store = new Map()

// Default TTL: 1 hour (from .env or fallback)
const DEFAULT_TTL = Number(process.env.CACHE_TTL_SECONDS || 3600) * 1000

/**
 * Build a deterministic cache key from classification params
 */
export function makeCacheKey({ aoiKey, year1, year2 }) {
  // Always sort years so (2015,2024) and (2024,2015) hit same cache
  const [y1, y2] = [year1, year2].sort()
  return `${aoiKey}::${y1}::${y2}`
}

/**
 * Get a value from cache. Returns null if missing or expired.
 */
export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

/**
 * Set a value in cache with optional TTL in milliseconds.
 */
export function cacheSet(key, value, ttlMs = DEFAULT_TTL) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
  })
}

/**
 * Delete a specific key (useful for manual cache busting)
 */
export function cacheDel(key) {
  store.delete(key)
}

/**
 * Return cache stats — useful for the /health endpoint
 */
export function cacheStats() {
  const now  = Date.now()
  let active = 0
  let expired = 0
  for (const [, entry] of store) {
    now > entry.expiresAt ? expired++ : active++
  }
  return { totalKeys: store.size, active, expired }
}

/**
 * Clear all cache entries — admin/debug use only
 */
export function cacheClear() {
  const count = store.size
  store.clear()
  return count
}
