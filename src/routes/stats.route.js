// ============================================================
// GET /api/stats/national
// Returns urban growth % and forest loss % for all 36 states
// Used by the national overview choropleth
// ============================================================
import ee from '@google/earthengine'
import { getAoiRegistry, getAoiGeometry, LULC_CLASSES } from '../services/gee.service.js'
import { cacheGet, cacheSet } from '../services/cache.service.js'

export default async function statsRoute(fastify) {

  fastify.get('/stats/national', async (req, reply) => {
    const { year1 = '2015', year2 = '2024' } = req.query
    const key = `national::${year1}::${year2}`
    const hit = cacheGet(key)
    if (hit) return reply.send({ ...hit, cached: true })

    fastify.log.info(`Computing national stats: ${year1} vs ${year2}`)

    const maskL8 = img => {
      const qa = img.select('QA_PIXEL')
      return img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<5).eq(0)))
        .select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
        .multiply(0.0000275).add(-0.2)
    }
    const maskL7 = img => {
      const qa = img.select('QA_PIXEL')
      return img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<5).eq(0)))
        .select(
          ['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'],
          ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7']
        )
        .multiply(0.0000275).add(-0.2)
    }
    const addIdx = img => img.addBands([
      img.normalizedDifference(['SR_B5','SR_B4']).rename('NDVI'),
      img.normalizedDifference(['SR_B3','SR_B5']).rename('NDWI'),
      img.normalizedDifference(['SR_B6','SR_B5']).rename('NDBI'),
    ])
    const getComp = (year, aoi) => {
      const col = Number(year) >= 2013
        ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(maskL8).map(addIdx)
        : ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(maskL7).map(addIdx)
      return col.median().clip(aoi)
    }

    const bands = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','NDVI','NDWI','NDBI']

    // ── BATCHED NODE.JS GEE COMPUTATION ──────────────────────
    // Instead of querying GEE for 37 states inside a single map function (which triggers
    // "Too many concurrent aggregations" error due to complex Random Forest training),
    // we query states metadata, then compute statistics for states in small batches of 5.
    const statesCol = ee.FeatureCollection('FAO/GAUL/2015/level1')
      .filter(ee.Filter.eq('ADM0_CODE', 182))

    const statesInfo = await new Promise((res, rej) =>
      statesCol.select(['ADM1_NAME', 'ADM1_CODE']).getInfo((d, e) => e ? rej(new Error(String(e))) : res(d))
    )

    const runBatches = async (items, batchSize, fn) => {
      const results = []
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        fastify.log.info(`Computing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)}`)
        const batchResults = await Promise.all(batch.map(fn))
        results.push(...batchResults)
      }
      return results
    }

    const getAreaFromGroups = (groups, classId) => {
      if (!Array.isArray(groups)) return 0
      const found = groups.find(g => g.class === classId)
      return found ? found.sum : 0
    }

    const computeState = async (feature) => {
      const stateName = feature.properties.ADM1_NAME
      const stateCode = feature.properties.ADM1_CODE
      const aoi = ee.FeatureCollection('FAO/GAUL/2015/level1')
        .filter(ee.Filter.eq('ADM1_CODE', stateCode))
        .geometry()
        .simplify(250)

      const wc    = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi)
      const remap = wc.remap([10,20,30,40,50,60,70,80,90,95,100],[0,0,1,1,2,4,4,3,0,0,4]).rename('landclass')
      const pts   = remap.stratifiedSample({ numPoints:30, classBand:'landclass', region:aoi, scale:300, seed:42, geometries:true })

      const comp2 = getComp(year2, aoi)
      const samp  = comp2.select(bands).sampleRegions({ collection:pts, properties:['landclass'], scale:300, tileScale:2 })
      const clf   = ee.Classifier.smileRandomForest({ numberOfTrees:30, seed:42 }).train({ features:samp, classProperty:'landclass', inputProperties:bands })

      const c1 = getComp(year1, aoi).select(bands).classify(clf)
      const c2 = getComp(year2, aoi).select(bands).classify(clf)

      const pixelArea = ee.Image.pixelArea().divide(1e6)

      const stats1 = pixelArea.addBands(c1).reduceRegion({
        reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
        geometry: aoi,
        scale: 300,
        maxPixels: 1e9,
        tileScale: 4
      }).get('groups')

      const stats2 = pixelArea.addBands(c2).reduceRegion({
        reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
        geometry: aoi,
        scale: 300,
        maxPixels: 1e9,
        tileScale: 4
      }).get('groups')

      // Fetch combined results in a single call to save roundtrips
      const combined = ee.Dictionary({ stats1, stats2 })
      const data = await new Promise((res, rej) =>
        combined.getInfo((d, e) => e ? rej(new Error(String(e))) : res(d))
      )

      const forest_y1 = getAreaFromGroups(data.stats1, 0)
      const forest_y2 = getAreaFromGroups(data.stats2, 0)
      const urban_y1  = getAreaFromGroups(data.stats1, 2)
      const urban_y2  = getAreaFromGroups(data.stats2, 2)

      const forestLoss  = forest_y1 > 0 ? ((forest_y1 - forest_y2) / forest_y1 * 100) : 0
      const urbanGrowth = urban_y1  > 0 ? ((urban_y2  - urban_y1)  / urban_y1  * 100) : 0

      const key = `state-${stateName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${stateCode}`
      const meta = getAoiRegistry()[key] || {
        zone: 'Other',
        lat: 9.0,
        lng: 7.0
      }

      return {
        key,
        label:       `${stateName} State`,
        state:       stateName,
        zone:        meta.zone,
        lat:         meta.lat,
        lng:         meta.lng,
        forestLoss:  Number(forestLoss.toFixed(1)),
        urbanGrowth: Number(urbanGrowth.toFixed(1)),
        forest_y1:   Number((forest_y1 || 0).toFixed(1)),
        forest_y2:   Number((forest_y2 || 0).toFixed(1)),
        urban_y1:    Number((urban_y1  || 0).toFixed(1)),
        urban_y2:    Number((urban_y2  || 0).toFixed(1)),
      }
    }

    const states = await runBatches(statesInfo.features, 5, computeState)

    const result = { year1, year2, states }
    cacheSet(key, result, 14400 * 1000) // 4hr cache
    return reply.send({ ...result, cached: false })
  })
}