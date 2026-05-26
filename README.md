# Weather App — Enterprise Internship Project

Multi-week DevOps internship building a production-ready Next.js weather application.

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, merged work — production-ready code |
| `Week 1` | Week 1 deliverables (Docker, app scaffold, IaC base) |
| `Week 2` | Week 2 deliverables (added on merge) |
| `Week 3` | Week 3 deliverables (added on merge) |
| `Week 4` | Week 4 deliverables (added on merge) |

Each week's work is isolated on its own branch, tested independently, and merged
into `main` only after explicit approval.

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript
- **Maps:** MapLibre GL + OpenFreeMap (no API key required)
- **Weather data:** OpenWeatherMap free tier
- **Container:** Docker (multi-stage build, Node 20 Alpine)
- **Orchestration:** Docker Compose (local)
- **CI/CD:** AWS CodePipeline + CodeBuild (added in later weeks)

## Local Development

```bash
# 1. Copy env template and add your OpenWeather API key
cp .env.example .env.local

# 2. Build and start
docker compose up --build

# 3. Open
http://localhost
```
