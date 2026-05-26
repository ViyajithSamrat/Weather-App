# =============================================================================
# STAGE 1: deps — install only production-relevant node_modules
# =============================================================================
FROM node:20-alpine AS deps

# Install libc compat for Alpine (required by some native Node modules)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Build context is the REPO ROOT (so IaC tooling, buildspecs, and CI all point
# to the same Dockerfile). App source lives in the weather-app/ subdirectory.
# Copying manifests first maximises layer-cache reuse across builds.
COPY weather-app/package.json weather-app/package-lock.json ./

# npm install (not ci) so Docker resolves package.json directly —
# avoids lock-file sync errors when dependencies change without a local npm install.
RUN npm install

# =============================================================================
# STAGE 2: builder — compile the Next.js application
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Carry forward installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy only the app source — NOT the entire repo root (infra/, docs/, .aws/ etc.)
COPY weather-app/ .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Produce a standalone output — smallest possible runtime bundle
RUN npm run build

# =============================================================================
# STAGE 3: runner — minimal production image
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy only the artifacts required to run the app
COPY --from=builder /app/public           ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static

# Assign ownership to the non-root user
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Healthcheck — ECS uses this to decide if the task is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
