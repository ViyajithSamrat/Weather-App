# Dockerfile Validation Checklist

**Version:** 1.0  
**Date:** 2026-05-21  
**Scope:** `Dockerfile` at repo root (production image)

---

## How to Use

Run through this checklist before:
- Merging any change to `Dockerfile` or `next.config.ts`
- Promoting a build to staging or production
- Onboarding a new contributor who will work on the container

Status key: `[x]` Pass · `[ ]` Fail / Pending · `[~]` Not applicable

---

## 1. Multi-Stage Build Structure

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1 | Stage `deps` installs node_modules (devDeps included for build) | `[x]` | `npm ci --frozen-lockfile` |
| 1.2 | Stage `builder` performs `next build` and nothing else | `[x]` | Outputs `.next/standalone` |
| 1.3 | Stage `runner` copies ONLY the standalone output, no `node_modules` | `[x]` | ~60% smaller final image |
| 1.4 | Final stage is named `runner` and matches `docker-compose.yml` `target:` | `[x]` | `target: runner` |
| 1.5 | Each stage uses `--from=<stage-name>` (not stage index) | `[x]` | Resilient to stage reordering |

---

## 2. Base Image

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | Base image is `node:20-alpine` (not `node:20`, not `node:latest`) | `[x]` | All 3 stages |
| 2.2 | Node version pinned to a specific major (20), not `lts` or `latest` | `[x]` | Reproducible builds |
| 2.3 | `libc6-compat` installed in `deps` stage for Alpine musl compatibility | `[x]` | Required by some native modules |
| 2.4 | No `apt-get` or `apk add` in `runner` stage (attack surface minimised) | `[x]` | Runner is minimal |

**Verify current base digest:**
```bash
docker pull node:20-alpine
docker inspect node:20-alpine --format '{{index .RepoDigests 0}}'
```

---

## 3. Security

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1 | Container runs as non-root user (`nextjs`, uid 1001) | `[x]` | `USER nextjs` in runner stage |
| 3.2 | Non-root group created (`nodejs`, gid 1001) | `[x]` | `addgroup --system` |
| 3.3 | `/app` directory owned by `nextjs:nodejs` | `[x]` | `chown -R nextjs:nodejs /app` |
| 3.4 | No secrets in `ENV`, `ARG`, or `RUN` instructions | `[x]` | Only placeholder values in build args |
| 3.5 | `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` build-arg uses placeholder (real value in ECR) | `[x]` | `build_placeholder` default |
| 3.6 | `.dockerignore` excludes `.env`, `.env.local`, `node_modules`, `.git` | `[x]` | See `.dockerignore` |
| 3.7 | No `--allow-root`, `sudo`, or `chmod 777` patterns | `[x]` | Verified by grep |

**Verify no secrets leaked into image:**
```bash
docker history weather-app:local --no-trunc | grep -iE "(key|token|secret|password)"
```

---

## 4. Next.js Standalone Configuration

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | `output: 'standalone'` set in `next.config.ts` | `[x]` | Required for runner stage |
| 4.2 | `COPY --from=builder /app/.next/standalone ./` in runner stage | `[x]` | Self-contained server.js |
| 4.3 | `COPY --from=builder /app/.next/static ./.next/static` in runner stage | `[x]` | Static assets |
| 4.4 | `COPY --from=builder /app/public ./public` in runner stage | `[x]` | Public folder |
| 4.5 | Start command is `CMD ["node", "server.js"]` (not `next start`) | `[x]` | Standalone mode |
| 4.6 | `NEXT_TELEMETRY_DISABLED=1` set in builder and runner | `[x]` | No build-time analytics calls |

---

## 5. Health Check

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | `HEALTHCHECK` defined in `Dockerfile` | `[x]` | ECS uses this for task health |
| 5.2 | Health check path is `/` (returns 200) | `[x]` | Next.js root route |
| 5.3 | `--interval=30s` | `[x]` | Industry standard |
| 5.4 | `--timeout=5s` | `[x]` | Fails fast |
| 5.5 | `--start-period=15s` | `[x]` | Allows Next.js cold start |
| 5.6 | `--retries=3` | `[x]` | Three failures = unhealthy |
| 5.7 | Health check uses `wget` (not `curl` — Alpine default) | `[x]` | Alpine ships wget, not curl |

---

## 6. Port and Networking

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | `EXPOSE 3000` declared | `[x]` | Documentation + tooling hint |
| 6.2 | `PORT=3000` set in ENV | `[x]` | Next.js respects PORT env var |
| 6.3 | Port matches `ContainerPort` in `ecs.yml` and `docker-compose.yml` | `[x]` | All set to 3000 |

---

## 7. Build Reproducibility

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | `npm ci --frozen-lockfile` used (not `npm install`) | `[x]` | Respects `package-lock.json` |
| 7.2 | `package.json` and `package-lock.json` copied before `COPY . .` | `[x]` | Layer-cache efficient |
| 7.3 | Build args have safe defaults (placeholder strings, not empty) | `[x]` | `next build` won't fail on missing env |

---

## 8. Image Size Targets

Run after build to verify:

```bash
docker build -t weather-app:check .
docker images weather-app:check --format "{{.Size}}"
```

| Stage | Target | Acceptable Max |
|-------|--------|----------------|
| `deps` | < 400 MB | 600 MB |
| `builder` | < 800 MB | 1.2 GB |
| `runner` (final) | < 180 MB | 250 MB |

---

## 9. Vulnerability Scan

Run before any promotion to staging or production:

```bash
# Install Trivy: https://github.com/aquasecurity/trivy
trivy image --severity HIGH,CRITICAL weather-app:local
```

| # | Check | Status |
|---|-------|--------|
| 9.1 | Zero CRITICAL CVEs | `[ ]` Verify before each staging/prod promotion |
| 9.2 | HIGH CVEs reviewed and accepted or mitigated | `[ ]` Verify before each staging/prod promotion |
| 9.3 | Scan result documented in PR description | `[ ]` Required for staging/prod PRs |

---

## 10. Local Smoke Test

```bash
# Build and run locally
docker compose up --build

# Verify the app responds
curl -f http://localhost:3000/

# Verify healthcheck passes
docker inspect weather-app-local --format '{{.State.Health.Status}}'
# Expected: healthy
```

| # | Check | Status |
|---|-------|--------|
| 10.1 | `docker compose up --build` completes without errors | `[ ]` Run locally |
| 10.2 | `http://localhost:3000/` returns HTTP 200 | `[ ]` Run locally |
| 10.3 | Container health status is `healthy` after 60s | `[ ]` Run locally |
| 10.4 | No JavaScript errors in browser console | `[ ]` Run locally |
| 10.5 | Weather data loads (requires real API keys in `.env.local`) | `[ ]` Run with real keys |

---

## Sign-off

| Environment | Validated By | Date | Signature |
|-------------|-------------|------|-----------|
| dev | | | |
| qa | | | |
| staging | | | |
| prod | | | |
