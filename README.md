# LULC Change Detection — Backend API

Fastify + Bun backend serving Google Earth Engine LULC classification data for the Nigeria dashboard.

---

## Stack
- **Runtime:** Bun (primary) or Node.js 18+ (fallback)
- **Framework:** Fastify 4
- **GEE SDK:** @google/earthengine
- **Classifier:** Random Forest (50 trees) trained on ESA WorldCover v200

---

## Setup

### 1. Install dependencies
```bash
# With Bun (recommended)
bun install

# With npm
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your values.

### 3. Add your GEE service account key
- Go to [Google Cloud Console](https://console.cloud.google.com)
- IAM & Admin → Service Accounts → your account → Keys → Add Key → JSON
- Save the downloaded file as `gee-service-account.json` in this folder
- Make sure `GEE_KEY_FILE=./gee-service-account.json` in your `.env`

### 4. Run in development
```bash
bun dev         # Bun with hot reload
npm run dev:node  # Node.js with --watch
```

### 5. Run in production
```bash
bun start
npm start
```

---

## API Reference

### `GET /health`
Server status + cache stats.

### `GET /api/aoi`
Returns all available locations for the frontend dropdown.
```json
{
  "locations": [
    { "key": "ogidi-ilorin-west", "label": "Ogidi, Ilorin West LGA", "state": "Kwara", ... }
  ],
  "yearRange": { "min": 2000, "max": 2024 }
}
```

### `GET /api/classify?aoiKey=ogidi-ilorin-west&year1=2015&year2=2024`
Main classification endpoint. Returns tile URLs + area stats for both years.
Results are cached for `CACHE_TTL_SECONDS` (default 1 hour).

Add `&bust=1` to bypass cache and recompute.

**Response:**
```json
{
  "aoi": { "key": "...", "label": "...", "center": { "lat": 8.517, "lng": 4.500 } },
  "year1": {
    "year": 2015,
    "tileUrl": "https://earthengine.googleapis.com/map/{mapId}/{z}/{x}/{y}?token={token}",
    "stats": [
      { "classId": 0, "name": "Forest", "color": "#2e7d32", "areaKm2": 142.5 },
      ...
    ]
  },
  "year2": { ... },
  "classes": [...],
  "cached": false,
  "durationMs": 8420
}
```

### `GET /api/tiles/:mapId/:z/:x/:y?token=...`
Tile proxy — fetches GEE raster tiles server-side and streams to client.
Used by Leaflet as the tile URL in the frontend.

---

## Adding more locations
Edit `src/services/gee.service.js` → `AOI_REGISTRY`:
```js
'your-location-key': {
  label:   'Your Location Name',
  state:   'State Name',
  lat:     9.0000,
  lng:     7.0000,
  bufferM: 15000,
},
```
No other code changes needed — it appears in the dropdown automatically.

---

## Deployment (Railway)
1. Push to GitHub
2. New project on [Railway](https://railway.app) → Deploy from GitHub
3. Add environment variables from your `.env`
4. Upload `gee-service-account.json` as a Railway volume or encode it as a base64 env var
5. Railway auto-detects Bun and runs `bun start`
