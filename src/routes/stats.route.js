// ============================================================
// GET /api/stats/national
// Returns urban growth % and forest loss % for all 36 states
// Used by the national overview choropleth
// ============================================================
import ee from '@google/earthengine'
import { AOI_REGISTRY, LULC_CLASSES } from '../services/gee.service.js'
import { cacheGet, cacheSet } from '../services/cache.service.js'

export default async function statsRoute(fastify) {

  fastify.get('/stats/national', async (req, reply) => {
    const { year1 = '2015', year2 = '2024' } = req.query
    const key = `national::${year1}::${year2}`
    const hit = cacheGet(key)
    if (hit) return reply.send({ ...hit, cached: true })

    fastify.log.info(`Computing national stats: ${year1} vs ${year2}`)

    const mask = img => {
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
    const getComp = (year, aoi) => {
      const col = Number(year) >= 2013
        ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(mask).map(addIdx)
        : ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(mask).map(addIdx)
      return col.median().clip(aoi)
    }

    const bands = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','NDVI','NDWI','NDBI']

    // Only compute for states (not LGAs) to keep computation manageable
    const stateKeys = Object.entries(AOI_REGISTRY)
      .filter(([k]) => k !== 'ogidi-ilorin-west')
      .map(([k]) => k)

    const stateResults = []

    for (const key of stateKeys) {
      const meta = AOI_REGISTRY[key]
      const aoi  = ee.Geometry.Point([meta.lng, meta.lat]).buffer(meta.bufferM)

      const wc    = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi)
      const remap = wc.remap([10,20,30,40,50,60,70,80,90,95,100],[0,0,1,1,2,4,4,3,0,0,4]).rename('landclass')
      const pts   = remap.stratifiedSample({ numPoints:80, classBand:'landclass', region:aoi, scale:30, seed:42, geometries:true })

      const comp2 = getComp(year2, aoi)
      const samp  = comp2.select(bands).sampleRegions({ collection:pts, properties:['landclass'], scale:30, tileScale:2 })
      const clf   = ee.Classifier.smileRandomForest({ numberOfTrees:30, seed:42 }).train({ features:samp, classProperty:'landclass', inputProperties:bands })

      const c1 = getComp(year1, aoi).select(bands).classify(clf)
      const c2 = getComp(year2, aoi).select(bands).classify(clf)
      const pa  = ee.Image.pixelArea().divide(1e6)

      const getArea = (classified, classId) =>
        pa.updateMask(classified.eq(classId))
          .reduceRegion({ reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e9, tileScale: 4 })
          .get('area')

      const feat = ee.Feature(null, {
        key,
        label:       meta.label,
        state:       meta.state,
        zone:        meta.zone || '',
        lat:         meta.lat,
        lng:         meta.lng,
        forest_y1:   getArea(c1, 0),
        forest_y2:   getArea(c2, 0),
        urban_y1:    getArea(c1, 2),
        urban_y2:    getArea(c2, 2),
        water_y1:    getArea(c1, 3),
        water_y2:    getArea(c2, 3),
      })
      stateResults.push(feat)
    }

    const fc   = ee.FeatureCollection(stateResults)
    const info = await new Promise((res, rej) =>
      fc.getInfo((d, e) => e ? rej(new Error(String(e))) : res(d))
    )

    const states = info.features.map(f => {
      const p = f.properties
      const forestLoss  = p.forest_y1 > 0 ? ((p.forest_y1 - p.forest_y2) / p.forest_y1 * 100) : 0
      const urbanGrowth = p.urban_y1  > 0 ? ((p.urban_y2  - p.urban_y1)  / p.urban_y1  * 100) : 0
      return {
        key:         p.key,
        label:       p.label,
        state:       p.state,
        zone:        p.zone,
        lat:         p.lat,
        lng:         p.lng,
        forestLoss:  Number(forestLoss.toFixed(1)),
        urbanGrowth: Number(urbanGrowth.toFixed(1)),
        forest_y1:   Number((p.forest_y1 || 0).toFixed(1)),
        forest_y2:   Number((p.forest_y2 || 0).toFixed(1)),
        urban_y1:    Number((p.urban_y1  || 0).toFixed(1)),
        urban_y2:    Number((p.urban_y2  || 0).toFixed(1)),
      }
    })

    const result = { year1, year2, states }
    cacheSet(key, result, 14400 * 1000) // 4hr cache
    return reply.send({ ...result, cached: false })
  })
}