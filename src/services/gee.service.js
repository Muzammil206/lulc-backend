// ============================================================
// src/services/gee.service.js
// All Google Earth Engine logic lives here.
// The routes never touch the EE API directly — only this file.
// ============================================================

import ee from '@google/earthengine'
import fs from 'fs'
import path from 'path'

// ── Internal state ───────────────────────────────────────────
let isInitialised = false

// ── AOI registry ─────────────────────────────────────────────
// Add more locations here as you expand the platform.
// Each entry has a centre point + optional custom buffer.
export const AOI_REGISTRY = {
  'ogidi-ilorin-west': {
    label: 'Ogidi, Ilorin West LGA',
    state: 'Kwara',
    lat: 8.517,
    lng: 4.500,
    bufferM: 15000,
  },
  'ilorin-metro': {
    label: 'Ilorin Metropolitan Area',
    state: 'Kwara',
    lat: 8.4966,
    lng: 4.5421,
    bufferM: 25000,
  },
  'lagos-island': {
    label: 'Lagos Island LGA',
    state: 'Lagos',
    lat: 6.4550,
    lng: 3.3841,
    bufferM: 15000,
  },
  'abuja-municipal': {
    label: 'Abuja Municipal Area',
    state: 'FCT',
    lat: 9.0579,
    lng: 7.4951,
    bufferM: 20000,
  },
  'kano-municipal': {
    label: 'Kano Municipal LGA',
    state: 'Kano',
    lat: 12.0022,
    lng: 8.5920,
    bufferM: 20000,
  },
}

// ── LULC class definitions ───────────────────────────────────
export const LULC_CLASSES = [
  { id: 0, name: 'Forest',   color: '#2e7d32' },
  { id: 1, name: 'Cropland', color: '#cddc39' },
  { id: 2, name: 'Urban',    color: '#e53935' },
  { id: 3, name: 'Water',    color: '#1565c0' },
  { id: 4, name: 'Bare',     color: '#9e9e9e' },
]

// ── Year range ───────────────────────────────────────────────
// Landsat 7: 1999–present (lower quality post-2003 due to SLC failure)
// Landsat 8: 2013–present (recommended)
// Landsat 9: 2021–present (same bands as L8)
export const YEAR_RANGE = { min: 2000, max: 2024 }

// ============================================================
// Initialise GEE with service account credentials
// Call this once at server startup
// ============================================================
export async function initGEE() {
  if (isInitialised) return

  const keyFilePath = path.resolve(process.env.GEE_KEY_FILE || './gee-service-account.json')

  if (!fs.existsSync(keyFilePath)) {
    throw new Error(
      `GEE service account key not found at: ${keyFilePath}\n` +
      'Download it from Google Cloud Console → IAM → Service Accounts → Keys\n' +
      'Then set GEE_KEY_FILE in your .env file'
    )
  }

  const key = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'))

  return new Promise((resolve, reject) => {
    // Authenticate with service account
    // In production this never requires a browser login — fully automated
    ee.data.authenticateViaPrivateKey(
      key,
      () => {
        ee.initialize(
          null, null,
          () => {
            isInitialised = true
            console.log('✓ Google Earth Engine initialised')
            resolve()
          },
          (err) => reject(new Error(`GEE initialisation failed: ${err}`))
        )
      },
      (err) => reject(new Error(`GEE authentication failed: ${err}`))
    )
  })
}

// ============================================================
// Cloud mask for Landsat 8/9 Collection 2 Surface Reflectance
// ============================================================
function cloudMaskL8(image) {
  const qa    = image.select('QA_PIXEL')
  const clear = qa.bitwiseAnd(1 << 3).eq(0)   // cloud shadow
                 .and(qa.bitwiseAnd(1 << 5).eq(0)) // cloud
  return image
    .updateMask(clear)
    .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
    .multiply(0.0000275).add(-0.2)
    .copyProperties(image, ['system:time_start'])
}

// Cloud mask for Landsat 7 (years < 2013)
function cloudMaskL7(image) {
  const qa    = image.select('QA_PIXEL')
  const clear = qa.bitwiseAnd(1 << 3).eq(0)
                 .and(qa.bitwiseAnd(1 << 5).eq(0))
  // L7 bands: B1=Blue B2=Green B3=Red B4=NIR B5=SWIR1 B7=SWIR2
  // Renamed to match L8 naming for consistent processing
  return image
    .updateMask(clear)
    .select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'],
            ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
    .multiply(0.0000275).add(-0.2)
    .copyProperties(image, ['system:time_start'])
}

// ============================================================
// Add spectral indices — dramatically improves class separation
// ============================================================
function addIndices(image) {
  const ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI')
  const ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI')
  const ndbi = image.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI')
  return image.addBands([ndvi, ndwi, ndbi])
}

// ============================================================
// Build median composite for a given year and AOI
// Automatically uses L8/L9 for 2013+ and L7 for earlier years
// ============================================================
function buildComposite(year, aoi) {
  const start  = `${year}-01-01`
  const end    = `${year}-12-31`
  const maxCC  = Number(process.env.MAX_CLOUD_COVER || 30)

  let collection

  if (year >= 2013) {
    // Landsat 8 + 9 merged for maximum scene coverage
    const l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(aoi).filterDate(start, end)
      .filter(ee.Filter.lt('CLOUD_COVER', maxCC))
      .map(cloudMaskL8).map(addIndices)

    const l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
      .filterBounds(aoi).filterDate(start, end)
      .filter(ee.Filter.lt('CLOUD_COVER', maxCC))
      .map(cloudMaskL8).map(addIndices) // same band structure as L8

    collection = l8.merge(l9)
  } else {
    // Landsat 7 for 2000–2012
    // Note: L7 has SLC-off data quality issues after 2003
    // but is still usable for median composites
    collection = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
      .filterBounds(aoi).filterDate(start, end)
      .filter(ee.Filter.lt('CLOUD_COVER', maxCC))
      .map(cloudMaskL7).map(addIndices)
  }

  return collection.median().clip(aoi)
}

// ============================================================
// Train Random Forest classifier using ESA WorldCover
// as the source of labeled training points
// ============================================================
function trainClassifier(composite, aoi) {
  const bands = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7',
                 'NDVI', 'NDWI', 'NDBI']

  // ESA WorldCover 10m — remapped to our 5 classes
  const worldcover = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi)
  const remapped   = worldcover.remap(
    [10,  20,  30,  40,  50,  60,  70,  80,  90,  95,  100],
    [ 0,   0,   1,   1,   2,   4,   4,   3,   0,   0,   4]
  ).rename('landclass')

  // Stratified sample — 100 pts per class
  const trainingPts = remapped.stratifiedSample({
    numPoints:  100,
    classBand:  'landclass',
    region:     aoi,
    scale:      30,
    seed:       42,
    geometries: true,
  })

  // Sample Landsat band values at each point
  const samples = composite.select(bands).sampleRegions({
    collection: trainingPts,
    properties: ['landclass'],
    scale:      30,
    tileScale:  2,
  })

  // Train Random Forest
  return ee.Classifier.smileRandomForest({ numberOfTrees: 50, seed: 42 })
    .train({
      features:        samples,
      classProperty:   'landclass',
      inputProperties: bands,
    })
}

// ============================================================
// Compute area statistics (km²) per LULC class
// ============================================================
function computeAreaStats(classified, aoi, year) {
  const pixelArea = ee.Image.pixelArea().divide(1e6) // m² → km²

  const features = LULC_CLASSES.map(({ id, name, color }) => {
    const area = pixelArea
      .updateMask(classified.eq(id))
      .reduceRegion({
        reducer:   ee.Reducer.sum(),
        geometry:  aoi,
        scale:     30,
        maxPixels: 1e9,
        tileScale: 2,
      })
    return ee.Feature(null, {
      year,
      classId:  id,
      name,
      color,
      areaKm2:  area.get('area'),
    })
  })

  return ee.FeatureCollection(features)
}

// ============================================================
// Main classification function
// Called by the /api/classify route
// Returns tile URLs + area stats for both years
// ============================================================
export async function classifyLULC({ aoiKey, year1, year2 }) {
  // Validate AOI
  const aoiMeta = AOI_REGISTRY[aoiKey]
  if (!aoiMeta) {
    throw new Error(`Unknown AOI key: "${aoiKey}". Valid keys: ${Object.keys(AOI_REGISTRY).join(', ')}`)
  }

  // Validate years
  if (year1 < YEAR_RANGE.min || year1 > YEAR_RANGE.max ||
      year2 < YEAR_RANGE.min || year2 > YEAR_RANGE.max) {
    throw new Error(`Years must be between ${YEAR_RANGE.min} and ${YEAR_RANGE.max}`)
  }

  const bufferM = aoiMeta.bufferM || Number(process.env.DEFAULT_BUFFER_METRES || 15000)
  const aoi     = ee.Geometry.Point([aoiMeta.lng, aoiMeta.lat]).buffer(bufferM)

  const bands   = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7',
                   'NDVI', 'NDWI', 'NDBI']

  const palette   = LULC_CLASSES.map(c => c.color)
  const visParams = { min: 0, max: 4, palette }

  // Build composites
  const comp1 = buildComposite(year1, aoi)
  const comp2 = buildComposite(year2, aoi)

  // Train classifier on year2 composite (most recent = best WorldCover match)
  const classifier = trainClassifier(comp2, aoi)

  // Classify both years
  const classified1 = comp1.select(bands).classify(classifier)
  const classified2 = comp2.select(bands).classify(classifier)

  // ── Get tile URLs from GEE ───────────────────────────────
  // Modern GEE Node SDK (v0.1.3xx+) returns `urlFormat` in the
  // getMapId response — NOT a separate `token` field.
  // urlFormat looks like:
  //   https://earthengine.googleapis.com/v1/projects/.../maps/.../tiles/{z}/{x}/{y}
  // We store this full URL and proxy it server-side.

  const getMapIdAsync = (image) =>
    new Promise((res, rej) =>
      image.getMapId({}, (obj, err) => {
        if (err) return rej(new Error(String(err)))
        res(obj)
      })
    )

  const getInfoAsync = (fc) =>
    new Promise((res, rej) =>
      fc.getInfo((obj, err) => {
        if (err) return rej(new Error(String(err)))
        res(obj)
      })
    )

  const [mapId1, mapId2, stats1, stats2] = await Promise.all([
    getMapIdAsync(classified1.visualize(visParams)),
    getMapIdAsync(classified2.visualize(visParams)),
    getInfoAsync(computeAreaStats(classified1, aoi, year1)),
    getInfoAsync(computeAreaStats(classified2, aoi, year2)),
  ])

  // Log the raw GEE response so you can inspect the shape
  console.log('GEE mapId1 keys:', Object.keys(mapId1))
  console.log('GEE mapId1 urlFormat:', mapId1.urlFormat)
  console.log('GEE mapId1 mapid:', mapId1.mapid)
  console.log('GEE mapId1 token:', mapId1.token)

  // Extract the tile URL template — handle both old and new SDK shapes
  // Old SDK: { mapid: '...', token: '...' }
  // New SDK: { urlFormat: 'https://.../{z}/{x}/{y}', mapid: '...' }
  const extractTileUrl = (mapIdObj) => {
    // New SDK: urlFormat is the complete tile URL template
    if (mapIdObj.urlFormat) {
      return mapIdObj.urlFormat
    }
    // Old SDK fallback: reconstruct from mapid + token
    if (mapIdObj.mapid && mapIdObj.token) {
      return `https://earthengine.googleapis.com/map/${mapIdObj.mapid}/{z}/{x}/{y}?token=${mapIdObj.token}`
    }
    // Last resort: check for tile_fetcher (Python SDK shape leaked via JS)
    if (mapIdObj.tile_fetcher && mapIdObj.tile_fetcher.url_format) {
      return mapIdObj.tile_fetcher.url_format
    }
    throw new Error(`Cannot extract tile URL from GEE response. Keys: ${Object.keys(mapIdObj).join(', ')}`)
  }

  const tileUrl1 = extractTileUrl(mapId1)
  const tileUrl2 = extractTileUrl(mapId2)

  console.log('Tile URL 1:', tileUrl1)
  console.log('Tile URL 2:', tileUrl2)

  // Format stats into clean arrays
  const formatStats = (featureCollection) =>
    featureCollection.features.map(f => ({
      classId: f.properties.classId,
      name:    f.properties.name,
      color:   f.properties.color,
      areaKm2: Number((f.properties.areaKm2 || 0).toFixed(2)),
      year:    f.properties.year,
    }))

  return {
    aoi: {
      key:    aoiKey,
      label:  aoiMeta.label,
      state:  aoiMeta.state,
      center: { lat: aoiMeta.lat, lng: aoiMeta.lng },
      bufferM,
    },
    year1: {
      year:       year1,
      // urlFormat is the full GEE tile template — frontend proxies it
      urlFormat:  tileUrl1,
      // Legacy fields kept for reference
      mapId:      mapId1.mapid  || '',
      token:      mapId1.token  || '',
      stats:      formatStats(stats1),
    },
    year2: {
      year:       year2,
      urlFormat:  tileUrl2,
      mapId:      mapId2.mapid  || '',
      token:      mapId2.token  || '',
      stats:      formatStats(stats2),
    },
    classes: LULC_CLASSES,
    classifier: {
      type:           'Random Forest',
      numberOfTrees:  50,
      trainingSource: 'ESA WorldCover v200',
      bandsUsed:      bands,
    },
  }
}