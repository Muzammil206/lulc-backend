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
// ── AOI Registry — All 36 Nigerian States + FCT + key LGAs ─
// bufferM is scaled to state size so the whole capital region fits
export const AOI_REGISTRY = {

  // ── Featured LGAs (most detailed) ──────────────────────
  'ogidi-ilorin-west': { label:'Ogidi, Ilorin West LGA', state:'Kwara', zone:'North Central', lat:8.517,  lng:4.500,  bufferM:15000 },

  // ── North West ─────────────────────────────────────────
  'jigawa':    { label:'Jigawa State',     state:'Jigawa',     zone:'North West',    lat:11.757, lng:9.342,  bufferM:40000 },
  'kaduna':    { label:'Kaduna State',     state:'Kaduna',     zone:'North West',    lat:10.524, lng:7.440,  bufferM:55000 },
  'kano':      { label:'Kano State',       state:'Kano',       zone:'North West',    lat:11.997, lng:8.576,  bufferM:45000 },
  'katsina':   { label:'Katsina State',    state:'Katsina',    zone:'North West',    lat:12.989, lng:7.615,  bufferM:45000 },
  'kebbi':     { label:'Kebbi State',      state:'Kebbi',      zone:'North West',    lat:12.460, lng:4.197,  bufferM:50000 },
  'sokoto':    { label:'Sokoto State',     state:'Sokoto',     zone:'North West',    lat:13.056, lng:5.244,  bufferM:45000 },
  'zamfara':   { label:'Zamfara State',    state:'Zamfara',    zone:'North West',    lat:12.163, lng:6.664,  bufferM:50000 },

  // ── North East ─────────────────────────────────────────
  'adamawa':   { label:'Adamawa State',    state:'Adamawa',    zone:'North East',    lat:9.204,  lng:12.496, bufferM:55000 },
  'bauchi':    { label:'Bauchi State',     state:'Bauchi',     zone:'North East',    lat:10.312, lng:9.843,  bufferM:55000 },
  'borno':     { label:'Borno State',      state:'Borno',      zone:'North East',    lat:11.841, lng:13.151, bufferM:65000 },
  'gombe':     { label:'Gombe State',      state:'Gombe',      zone:'North East',    lat:10.291, lng:11.167, bufferM:40000 },
  'taraba':    { label:'Taraba State',     state:'Taraba',     zone:'North East',    lat:8.883,  lng:11.373, bufferM:55000 },
  'yobe':      { label:'Yobe State',       state:'Yobe',       zone:'North East',    lat:11.748, lng:11.961, bufferM:55000 },

  // ── North Central ──────────────────────────────────────
  'benue':     { label:'Benue State',      state:'Benue',      zone:'North Central', lat:7.731,  lng:8.521,  bufferM:50000 },
  'fct':       { label:'FCT Abuja',        state:'FCT',        zone:'North Central', lat:9.057,  lng:7.495,  bufferM:25000 },
  'kogi':      { label:'Kogi State',       state:'Kogi',       zone:'North Central', lat:7.801,  lng:6.741,  bufferM:50000 },
  'kwara':     { label:'Kwara State',      state:'Kwara',      zone:'North Central', lat:8.497,  lng:4.542,  bufferM:50000 },
  'nasarawa':  { label:'Nasarawa State',   state:'Nasarawa',   zone:'North Central', lat:8.491,  lng:8.521,  bufferM:45000 },
  'niger':     { label:'Niger State',      state:'Niger',      zone:'North Central', lat:9.614,  lng:6.556,  bufferM:65000 },
  'plateau':   { label:'Plateau State',    state:'Plateau',    zone:'North Central', lat:9.896,  lng:8.858,  bufferM:50000 },

  // ── South West ─────────────────────────────────────────
  'ekiti':     { label:'Ekiti State',      state:'Ekiti',      zone:'South West',    lat:7.622,  lng:5.221,  bufferM:22000 },
  'lagos':     { label:'Lagos State',      state:'Lagos',      zone:'South West',    lat:6.453,  lng:3.396,  bufferM:18000 },
  'ogun':      { label:'Ogun State',       state:'Ogun',       zone:'South West',    lat:7.156,  lng:3.346,  bufferM:40000 },
  'ondo':      { label:'Ondo State',       state:'Ondo',       zone:'South West',    lat:7.252,  lng:5.195,  bufferM:40000 },
  'osun':      { label:'Osun State',       state:'Osun',       zone:'South West',    lat:7.767,  lng:4.557,  bufferM:28000 },
  'oyo':       { label:'Oyo State',        state:'Oyo',        zone:'South West',    lat:7.388,  lng:3.900,  bufferM:50000 },

  // ── South East ─────────────────────────────────────────
  'abia':      { label:'Abia State',       state:'Abia',       zone:'South East',    lat:5.529,  lng:7.486,  bufferM:22000 },
  'anambra':   { label:'Anambra State',    state:'Anambra',    zone:'South East',    lat:6.210,  lng:7.068,  bufferM:20000 },
  'ebonyi':    { label:'Ebonyi State',     state:'Ebonyi',     zone:'South East',    lat:6.325,  lng:8.113,  bufferM:22000 },
  'enugu':     { label:'Enugu State',      state:'Enugu',      zone:'South East',    lat:6.441,  lng:7.499,  bufferM:25000 },
  'imo':       { label:'Imo State',        state:'Imo',        zone:'South East',    lat:5.485,  lng:7.026,  bufferM:22000 },

  // ── South South ────────────────────────────────────────
  'akwa-ibom': { label:'Akwa Ibom State',  state:'Akwa Ibom',  zone:'South South',   lat:5.053,  lng:7.936,  bufferM:25000 },
  'bayelsa':   { label:'Bayelsa State',    state:'Bayelsa',    zone:'South South',   lat:4.926,  lng:6.262,  bufferM:28000 },
  'cross-river':{ label:'Cross River State',state:'Cross River',zone:'South South',  lat:4.951,  lng:8.322,  bufferM:40000 },
  'delta':     { label:'Delta State',      state:'Delta',      zone:'South South',   lat:6.198,  lng:6.734,  bufferM:38000 },
  'edo':       { label:'Edo State',        state:'Edo',        zone:'South South',   lat:6.338,  lng:5.627,  bufferM:38000 },
  'rivers':    { label:'Rivers State',     state:'Rivers',     zone:'South South',   lat:4.815,  lng:7.049,  bufferM:30000 },
}

// ── State to Geopolitical Zone mapping ───────────────────────
const STATE_TO_ZONE = {
  'Abia': 'South East', 'Anambra': 'South East', 'Ebonyi': 'South East', 'Enugu': 'South East', 'Imo': 'South East',
  'Adamawa': 'North East', 'Bauchi': 'North East', 'Borno': 'North East', 'Gombe': 'North East', 'Taraba': 'North East', 'Yobe': 'North East',
  'Akwa Ibom': 'South South', 'Bayelsa': 'South South', 'Cross River': 'South South', 'Delta': 'South South', 'Edo': 'South South', 'Rivers': 'South South',
  'Benue': 'North Central', 'Federal Capital Territory (FCT)': 'North Central', 'Kogi': 'North Central', 'Kwara': 'North Central', 'Nassarawa': 'North Central', 'Nasarawa': 'North Central', 'Niger': 'North Central', 'Plateau': 'North Central', 'Abuja': 'North Central',
  'Ekiti': 'South West', 'Lagos': 'South West', 'Ogun': 'South West', 'Ondo': 'South West', 'Osun': 'South West', 'Oyo': 'South West',
  'Jigawa': 'North West', 'Kaduna': 'North West', 'Kano': 'North West', 'Katsina': 'North West', 'Kebbi': 'North West', 'Sokoto': 'North West', 'Zamfara': 'North West'
}

// ── Dynamic AOI Registry ─────────────────────────────────────
export let DYNAMIC_AOI_REGISTRY = { ...AOI_REGISTRY }

export function getAoiRegistry() {
  return DYNAMIC_AOI_REGISTRY
}

export function getAoiGeometry(aoiKey) {
  const meta = DYNAMIC_AOI_REGISTRY[aoiKey]
  if (!meta) {
    throw new Error(`Unknown AOI key: "${aoiKey}"`)
  }

  if (meta.type === 'state') {
    return ee.FeatureCollection('FAO/GAUL/2015/level1')
      .filter(ee.Filter.eq('ADM1_CODE', meta.code))
      .geometry()
      .simplify(100)
  }

  if (meta.type === 'lga') {
    return ee.FeatureCollection('FAO/GAUL/2015/level2')
      .filter(ee.Filter.eq('ADM2_CODE', meta.code))
      .geometry()
      .simplify(50)
  }

  // Fallback: Custom featured AOI (circular buffer)
  const bufferM = meta.bufferM || Number(process.env.DEFAULT_BUFFER_METRES || 15000)
  return ee.Geometry.Point([meta.lng, meta.lat]).buffer(bufferM)
}

export async function populateDynamicRegistry() {
  console.log('Populating dynamic AOI registry from GEE (Nigeria States & LGAs)…')
  try {
    // 1. Fetch States (Level 1)
    const stateCol = ee.FeatureCollection('FAO/GAUL/2015/level1')
      .filter(ee.Filter.eq('ADM0_CODE', 182))

    const stateCentroids = stateCol.map(f => {
      const centroid = f.geometry().centroid(100)
      return ee.Feature(null, {
        name: f.get('ADM1_NAME'),
        code: f.get('ADM1_CODE'),
        lng: centroid.coordinates().get(0),
        lat: centroid.coordinates().get(1)
      })
    })

    // 2. Fetch LGAs (Level 2)
    const lgaCol = ee.FeatureCollection('FAO/GAUL/2015/level2')
      .filter(ee.Filter.eq('ADM0_CODE', 182))

    const lgaCentroids = lgaCol.map(f => {
      const centroid = f.geometry().centroid(100)
      return ee.Feature(null, {
        name: f.get('ADM2_NAME'),
        stateName: f.get('ADM1_NAME'),
        code: f.get('ADM2_CODE'),
        lng: centroid.coordinates().get(0),
        lat: centroid.coordinates().get(1)
      })
    })

    const [stateInfo, lgaInfo] = await Promise.all([
      new Promise((res, rej) =>
        stateCentroids.getInfo((data, err) => err ? rej(new Error(String(err))) : res(data))
      ),
      new Promise((res, rej) =>
        lgaCentroids.getInfo((data, err) => err ? rej(new Error(String(err))) : res(data))
      )
    ])

    const newRegistry = { ...AOI_REGISTRY }

    // Add States
    for (const f of stateInfo.features) {
      const p = f.properties
      const name = p.name || ''
      const code = p.code
      const key = `state-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${code}`
      const zone = STATE_TO_ZONE[name] || 'Other'
      newRegistry[key] = {
        key,
        label: `${name} State`,
        state: name,
        zone,
        lat: p.lat,
        lng: p.lng,
        type: 'state',
        code: code
      }
    }

    // Add LGAs
    for (const f of lgaInfo.features) {
      const p = f.properties
      const name = p.name || ''
      const stateName = p.stateName || ''
      const code = p.code
      const key = `lga-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${code}`
      const zone = STATE_TO_ZONE[stateName] || 'Other'
      newRegistry[key] = {
        key,
        label: `${name} LGA (${stateName})`,
        state: stateName,
        zone,
        lat: p.lat,
        lng: p.lng,
        type: 'lga',
        code: code
      }
    }

    DYNAMIC_AOI_REGISTRY = newRegistry
    console.log(`✓ Dynamic AOI registry populated: ${Object.keys(DYNAMIC_AOI_REGISTRY).length} total areas (States & LGAs)`)
  } catch (err) {
    console.error('Failed to populate dynamic AOI registry, falling back to static list:', err.message)
    DYNAMIC_AOI_REGISTRY = { ...AOI_REGISTRY }
  }
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

  let key

  // ── Strategy 1: GEE_KEY_JSON env var (Render / Railway / any PaaS)
  // In your hosting dashboard, add an env var:
  //   Name:  GEE_KEY_JSON
  //   Value: (paste the entire contents of gee-service-account.json)
  // This avoids uploading the file to the server entirely.
  if (process.env.GEE_KEY_JSON) {
    try {
      key = JSON.parse(process.env.GEE_KEY_JSON)
      console.log('GEE credentials loaded from GEE_KEY_JSON env var')
    } catch (e) {
      throw new Error('GEE_KEY_JSON is set but contains invalid JSON. Paste the raw file contents.')
    }

  // ── Strategy 2: GEE_KEY_FILE path (local development)
  } else {
    const keyFilePath = path.resolve(process.env.GEE_KEY_FILE || './gee-service-account.json')
    if (!fs.existsSync(keyFilePath)) {
      throw new Error(
        'GEE credentials not found.\n\n' +
        'FOR RENDER/RAILWAY DEPLOYMENT:\n' +
        '  Add env var: GEE_KEY_JSON = (entire contents of gee-service-account.json)\n\n' +
        'FOR LOCAL DEVELOPMENT:\n' +
        '  Place gee-service-account.json in the project root\n' +
        '  Or set GEE_KEY_FILE=/path/to/key.json in .env'
      )
    }
    key = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'))
    console.log('GEE credentials loaded from file:', keyFilePath)
  }

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
  const aoiMeta = DYNAMIC_AOI_REGISTRY[aoiKey]
  if (!aoiMeta) {
    throw new Error(`Unknown AOI key: "${aoiKey}". Valid keys: ${Object.keys(DYNAMIC_AOI_REGISTRY).join(', ')}`)
  }

  // Validate years
  if (year1 < YEAR_RANGE.min || year1 > YEAR_RANGE.max ||
      year2 < YEAR_RANGE.min || year2 > YEAR_RANGE.max) {
    throw new Error(`Years must be between ${YEAR_RANGE.min} and ${YEAR_RANGE.max}`)
  }

  const aoi     = getAoiGeometry(aoiKey)
  const bufferM = aoiMeta.bufferM || 0

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