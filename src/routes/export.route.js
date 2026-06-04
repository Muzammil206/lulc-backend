// ============================================================
// POST /api/export     — start a GEE export task
// GET  /api/export/:id — poll task status
// ============================================================
import ee from '@google/earthengine'
import { getAoiRegistry, getAoiGeometry, LULC_CLASSES } from '../services/gee.service.js'

// In-memory task store (use Redis in production)
const tasks = new Map()

function buildComposite(year, aoi) {
  const maskL8 = img => {
    const qa = img.select('QA_PIXEL')
    return img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<5).eq(0)))
      .select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
      .multiply(0.0000275).add(-0.2)
  }

  // L7 C2 SR bands: B1=Blue B2=Green B3=Red B4=NIR B5=SWIR1 B7=SWIR2 (no SR_B6)
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
  const col = year >= 2013
    ? ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(maskL8).map(addIdx)
    : ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterBounds(aoi).filterDate(`${year}-01-01`,`${year}-12-31`).filter(ee.Filter.lt('CLOUD_COVER',30)).map(maskL7).map(addIdx)
  return col.median().clip(aoi)
}

export default async function exportRoute(fastify) {

  // POST /api/export — kick off a Drive export
  fastify.post('/export', async (req, reply) => {
    const { aoiKey, year, format = 'GeoTIFF' } = req.body || {}
    if (!aoiKey || !year) {
      return reply.code(400).send({ error: 'aoiKey and year required' })
    }
    const meta = getAoiRegistry()[aoiKey]
    if (!meta) return reply.code(400).send({ error: `Unknown aoiKey: "${aoiKey}"` })

    const taskId = `${aoiKey}-${year}-${Date.now()}`
    tasks.set(taskId, { id: taskId, status: 'RUNNING', aoiKey, year, startedAt: new Date().toISOString() })

    // Kick off async export
    ;(async () => {
      try {
        const aoi    = getAoiGeometry(aoiKey)
        const bands  = ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','NDVI','NDWI','NDBI']
        const comp   = buildComposite(year, aoi)
        const wc     = ee.ImageCollection('ESA/WorldCover/v200').first().clip(aoi)
        const remap  = wc.remap([10,20,30,40,50,60,70,80,90,95,100],[0,0,1,1,2,4,4,3,0,0,4]).rename('landclass')
        const pts    = remap.stratifiedSample({ numPoints:100, classBand:'landclass', region:aoi, scale:30, seed:42, geometries:true })
        const samp   = comp.select(bands).sampleRegions({ collection:pts, properties:['landclass'], scale:30, tileScale:2 })
        const clf    = ee.Classifier.smileRandomForest({ numberOfTrees:50, seed:42 }).train({ features:samp, classProperty:'landclass', inputProperties:bands })
        const classified = comp.select(bands).classify(clf)
        const palette    = LULC_CLASSES.map(c => c.color)

        const task = ee.batch.Export.image.toDrive({
          image:       classified.visualize({ min:0, max:4, palette }),
          description: `LULC_${meta.state.replace(/\s/g,'_')}_${year}`,
          folder:      'LULC_Nigeria_Exports',
          region:      aoi,
          scale:       30,
          maxPixels:   1e10,
          fileFormat:  'GeoTIFF',
        })

        task.start()
        tasks.set(taskId, { ...tasks.get(taskId), geeTaskId: task.id, status: 'SUBMITTED' })

        // Poll every 10s for up to 10min
        const poll = setInterval(() => {
          task.status((s, e) => {
            if (e) { clearInterval(poll); tasks.set(taskId, { ...tasks.get(taskId), status:'FAILED', error: String(e) }); return }
            const st = s?.state
            tasks.set(taskId, { ...tasks.get(taskId), status: st, geeStatus: s })
            if (st === 'COMPLETED' || st === 'FAILED' || st === 'CANCELLED') clearInterval(poll)
          })
        }, 10000)

      } catch (err) {
        tasks.set(taskId, { ...tasks.get(taskId), status: 'FAILED', error: err.message })
      }
    })()

    return reply.code(202).send({ taskId, message: 'Export started. Check Google Drive → LULC_Nigeria_Exports folder.' })
  })

  // GET /api/export/:id — poll status
  fastify.get('/export/:id', async (req, reply) => {
    const task = tasks.get(req.params.id)
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    return reply.send(task)
  })
}