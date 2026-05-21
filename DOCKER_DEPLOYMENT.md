# Docker Deployment Guide

## Quick Start (Local Development)

### Build and run with Docker Compose:

```bash
docker-compose up --build
```

The API will be available at `http://localhost:3001`

Health check: `http://localhost:3001/health`

### Run with Docker directly:

```bash
# Build the image
docker build -t lulc-backend:latest .

# Run the container
docker run -p 3001:3001 \
  -e FRONTEND_URL=http://localhost:3000 \
  -v $(pwd)/gee-service-account.json:/app/gee-service-account.json:ro \
  lulc-backend:latest
```

## Environment Variables

Set these via `-e` flag or in `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `NODE_ENV` | `production` | Environment mode |
| `GEE_KEY_FILE` | `/app/gee-service-account.json` | Path to GEE service account key |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowed origin |
| `MAX_CLOUD_COVER` | `30` | Max cloud cover % for Landsat images |
| `DEFAULT_BUFFER_METRES` | `15000` | Default AOI buffer in meters |

## Production Deployment

### Railway / Render / Cloud Run

1. **Ensure `gee-service-account.json` is added as a secret** in your deployment platform
2. **Set environment variables** in the platform's dashboard
3. **Deploy the repository** — the platform will automatically detect the Dockerfile

### Example: Railway Deployment

```bash
# Login to Railway
railway login

# Link project
railway link

# Set secrets
railway variable set GEE_KEY_FILE="path-or-content"
railway variable set FRONTEND_URL="https://your-frontend.vercel.app"

# Deploy
railway up
```

### Example: Google Cloud Run

```bash
# Build and push to Container Registry
gcloud builds submit --tag gcr.io/YOUR-PROJECT/lulc-backend

# Deploy
gcloud run deploy lulc-backend \
  --image gcr.io/YOUR-PROJECT/lulc-backend \
  --platform managed \
  --region us-central1 \
  --port 3001 \
  --set-env-vars FRONTEND_URL=https://your-frontend.vercel.app \
  --allow-unauthenticated
```

## Dockerfile Details

**Multi-stage build:**
- **Stage 1 (Builder)**: Installs dependencies using `bun install`
- **Stage 2 (Runtime)**: Minimal production image with only necessary files

**Optimizations:**
- Uses official `oven/bun` image (lightweight)
- `dumb-init` ensures proper signal handling (graceful shutdown)
- Health check endpoint monitors `/health`
- `.dockerignore` reduces image size

## Troubleshooting

### Container exits immediately

Check logs:
```bash
docker logs <container-id>
```

Ensure `gee-service-account.json` is properly mounted or present in the image.

### Health check failing

Verify the container is running:
```bash
docker ps
```

Check if port 3001 is accessible:
```bash
curl http://localhost:3001/health
```

### High memory usage

Bun is memory-efficient, but GEE processing is computationally intensive. If you see OOM errors, increase Docker's memory limit:

```bash
docker run -m 2g -p 3001:3001 lulc-backend:latest
```

## Image Size

Final image size: ~400-500MB (mostly dependencies)

To reduce further, use Alpine-based image (if Bun Alpine is available):
```dockerfile
FROM oven/bun:alpine-latest
```

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: your-registry/lulc-backend:latest
```
