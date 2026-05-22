# ============================================================
# Dockerfile for LULC Backend
# Multi-stage build for optimized production image
# Supports both Bun and Node.js runtimes
# ============================================================

# ── Stage 1: Builder ─────────────────────────────────────────
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src


# ── Stage 2: Runtime ────────────────────────────────────────
FROM oven/bun:latest

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src


# Copy .env file (optional - can also pass via docker run -e)
COPY .env* ./

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun run -e "const res = await fetch('http://localhost:3001/health'); process.exit(res.ok ? 0 : 1)"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["bun", "src/server.js"]
