// ============================================================
// GET /api/timeseries?aoiKey=...&startYear=2000&endYear=2024
// Returns area statistics for every year in the range.
// Used by the frontend time series chart.
// ============================================================
import ee from '@google/earthengine'
import { AOI_REGISTRY, LULC_CLASSES } from '../services/gee.service.js'
import { makeCacheKey, cacheGet, cacheSet } from '../services/cache.service.js'

function buildComposite(year, aoi) {
  const start = `${year}-01-01`
  const end   = `${year}-12-31`
  const mask  = img => {
    const qa = img.select('QA_PIXEL')
    return img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<5).eq(0)))
      .select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
      .multiply(0.0000275).add(-0.2)
  }
  const addIdx = img => img.addBands([
    img.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI'),
    img.normalizedDifference(['SR_B3','SR_B5']).rename('NDWI'),
    img.normalizedDifference(['SR_B6','SR_B5']).rename('NDBI'),
  ])
  const col = year >= 2013
    ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(aoi).filterDate(start,end).filter(ee.Filter.lt('CLOUD_COVER',30)).map(mask).map(addIdx)
    : ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterBounds(aoi).filterDate(start,end).filter(ee.Filter.lt('CLOUD_COVER',30)).map(mask).map(addIdx)
  return col.median().clip(aoi)
}

function trainClassifier(comp, aoi) {
  const bands = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','NDVI','NDWI','NDBI']
  const wc    = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi)
  const remap = wc.remap([10,20,30,40,50,60,70,80,90,95,100],[0,0,1,1,2,4,4,3,0,0,4]).rename('landclass')
  const pts   = remap.stratifiedSample({ numPoints:100, classBand:'landclass', region:aoi, scale:30, seed:42, geometries:true })
  const samp  = comp.select(bands).sampleRegions({ collection:pts, properties:['landclass'], scale:30, tileScale:2 })
  return ee.Classifier.smileRandomForest({ numberOfTrees:50, seed:42 })
    .train({ features:samp, classProperty:'landclass', inputProperties:bands })
}

export default async function timeseriesRoute(fastify) {
  fastify.get('/timeseries', async (req, reply) => {
    const { aoiKey, startYear='2000', endYear='2024' } = req.query
    if (!aoiKey || !AOI_REGISTRY[aoiKey]) {
      return reply.code(400).send({ error: `Unknown aoiKey: "${aoiKey}"` })
    }

    const y1  = Math.max(2000, parseInt(startYear))
    const y2  = Math.min(2024, parseInt(endYear))
    const key = `ts::${aoiKey}::${y1}::${y2}`
    const hit = cacheGet(key)
    if (hit) return reply.send({ ...hit, cached: true })

    fastify.log.info(`Timeseries: ${key}`)
    const meta   = AOI_REGISTRY[aoiKey]
    const aoi    = ee.Geometry.Point([meta.lng, meta.lat]).buffer(meta.bufferM)
    const bands  = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','NDVI','NDWI','NDBI']
    const pixArea = ee.Image.pixelArea().divide(1e6)

    // Build a reference composite (latest year) for training
    const refComp   = buildComposite(Math.min(y2, 2023), aoi)
    const classifier = trainClassifier(refComp, aoi)

    // Compute stats for each year
    const yearList = []
    for (let y = y1; y <= y2; y++) yearList.push(y)

    const computeYear = year => {
      const comp       = buildComposite(year, aoi)
      const classified = comp.select(bands).classify(classifier)
      const stats      = LULC_CLASSES.map(({ id, name, color }) => {
        const area = pixArea.updateMask(classified.eq(id))
          .reduceRegion({ reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e9, tileScale: 2 })
        return ee.Feature(null, { year, classId: id, name, color, areaKm2: area.get('area') })
      })
      return ee.FeatureCollection(stats)
    }

    // Merge all years into one FeatureCollection
    const allStats = yearList.reduce((acc, y) => acc.merge(computeYear(y)), ee.FeatureCollection([]))

    const info = await new Promise((res, rej) =>
      allStats.getInfo((d, e) => e ? rej(new Error(String(e))) : res(d))
    )

    // Shape into { year: { className: areaKm2 } }
    const byYear = {}
    for (const f of info.features) {
      const { year, name, areaKm2 } = f.properties
      if (!byYear[year]) byYear[year] = { year }
      byYear[year][name] = Number((areaKm2 || 0).toFixed(2))
    }

    const series = Object.values(byYear).sort((a, b) => a.year - b.year)
    const result = { aoiKey, startYear: y1, endYear: y2, classes: LULC_CLASSES, series }
    cacheSet(key, result, 7200 * 1000) // 2hr cache — expensive computation
    return reply.send({ ...result, cached: false })
  })
}