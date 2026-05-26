# Enterprise Weather Application — High Level Design (HLD)

**Version:** 1.0  
**Date:** 2026-05-21  
**Author:** DevOps Platform Team  
**Status:** Approved — Week 1 Scaffold

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Application Analysis](#2-application-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Environment Strategy](#4-environment-strategy)
5. [Container Strategy](#5-container-strategy)
6. [CI/CD Pipeline Design](#6-cicd-pipeline-design)
7. [Infrastructure as Code Strategy](#7-infrastructure-as-code-strategy)
8. [Security Architecture](#8-security-architecture)
9. [Cost Model](#9-cost-model)
10. [Branching & Promotion Strategy](#10-branching--promotion-strategy)
11. [Decisions Log (ADR)](#11-decisions-log-adr)

---

## 1. Executive Summary

This document describes the end-to-end DevOps platform for the **Enterprise Weather Application** — a Next.js 16 / React 19 weather dashboard containerised with Docker and deployed on AWS ECS Fargate via an automated CodePipeline CI/CD system.

The platform provides:
- **4 fully isolated environments** (dev → qa → staging → prod)
- **Immutable, container-based deployments** via ECR + ECS Fargate
- **Infrastructure as Code** via CloudFormation (zero manual console work)
- **Least-privilege security** (IAM, Secrets Manager, no hardcoded credentials)
- **AWS Free-Tier / cost-optimised** sizing for non-production environments

---

## 2. Application Analysis

| Property | Value |
|---|---|
| Framework | Next.js 16.1.6 |
| Runtime | React 19.2.3 (RSC + Server Actions) |
| Language | TypeScript 5 |
| CSS | Tailwind CSS 4 |
| State | Zustand 5 |
| Build output | `.next/standalone` (self-contained Node server) |
| Default port | 3000 |
| Node target | 20 LTS |

### External API Dependencies

| API | Env Var | Side | Secret Store |
|---|---|---|---|
| OpenWeather | `OPENWEATHER_API_KEY` | Server-only | SSM SecureString (dev/qa) / Secrets Manager (staging/prod) |
| Mapbox | `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Client + Server | SSM String (dev/qa) / Secrets Manager (staging/prod) |

### Key Architectural Notes

- **`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`** is baked into the client bundle at `next build` time. It must be supplied as a Docker `--build-arg`. Restrict the token by domain/URL in the Mapbox dashboard.
- **`OPENWEATHER_API_KEY`** is server-side only; it is injected at ECS task runtime and never appears in the browser.
- The app uses **Next.js Server Actions** and a **tile proxy API route** (`/api/weather/[layer]/...`) to keep the OpenWeather key server-side.
- Build output uses `output: 'standalone'` — the `server.js` entry point does NOT require a separate Next.js installation in the runner image.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AWS CLOUD  (us-east-1)                             │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  VPC  (weather-app-vpc)                                              │  │
│  │                                                                      │  │
│  │  ┌────────────────────┐    ┌────────────────────────────────────┐   │  │
│  │  │  PUBLIC SUBNETS    │    │  PRIVATE SUBNETS                   │   │  │
│  │  │  (2x AZ)           │    │  (2x AZ)                          │   │  │
│  │  │                    │    │                                    │   │  │
│  │  │  ┌──────────────┐  │    │  ┌──────────────────────────────┐ │   │  │
│  │  │  │ Application  │  │    │  │  ECS Fargate Cluster         │ │   │  │
│  │  │  │ Load Balancer│◄─┼────┼─►│  ┌────────┐  ┌────────┐    │ │   │  │
│  │  │  │ (ALB)        │  │    │  │  │Task    │  │Task    │    │ │   │  │
│  │  │  │ Port 80/443  │  │    │  │  │weather │  │weather │    │ │   │  │
│  │  │  └──────────────┘  │    │  │  │:3000   │  │:3000   │    │ │   │  │
│  │  └────────────────────┘    │  │  └────────┘  └────────┘    │ │   │  │
│  │                            │  └──────────────────────────────┘ │   │  │
│  │                            └────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CI/CD Platform                                                      │   │
│  │                                                                      │   │
│  │  GitHub ──► CodePipeline ──► CodeBuild ──► ECR ──► ECS Deploy       │   │
│  │               │                                                      │   │
│  │               ├─ Source Stage  (GitHub webhook)                      │   │
│  │               ├─ Build Stage   (Docker build + push)                 │   │
│  │               ├─ Approval Gate (staging + prod only)                 │   │
│  │               └─ Deploy Stage  (ECS rolling update)                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
│  │  ECR              │  │  SSM Param Store │  │  CloudWatch Logs     │    │
│  │  (per-env repos)  │  │  (secrets/config)│  │  (ECS task logs)     │    │
│  └───────────────────┘  └──────────────────┘  └──────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

  Developer ──► GitHub ──► ALB DNS ──► ECS Task ──► OpenWeather API
                                                  └──► Mapbox API
```

---

## 4. Environment Strategy

| Environment | Branch | Purpose | ECS CPU/Mem | Desired Tasks | Approval Required |
|---|---|---|---|---|---|
| **dev** | `dev` | Active development integration | 256 / 512 MB | 1 | No |
| **qa** | `qa` | QA / automated testing | 256 / 512 MB | 1 | No |
| **staging** | `staging` | Pre-prod validation | 512 / 1024 MB | 2 | Yes (manual) |
| **prod** | `main` | Live production | 512 / 1024 MB | 2 | Yes (manual) |

Each environment has **fully isolated** AWS resources:
- Separate ECR repository: `weather-app-<env>`
- Separate ECS cluster: `weather-app-<env>-cluster`
- Separate CloudFormation stacks: `weather-app-<env>-ecr`, `weather-app-<env>-ecs`, `weather-app-<env>-pipeline`
- Separate SSM parameter namespaces: `/weather-app/<env>/...`

---

## 5. Container Strategy

### Multi-Stage Dockerfile Design

```
Stage 1: deps    (node:20-alpine)
  └── npm ci --frozen-lockfile
      └── Output: /app/node_modules

Stage 2: builder (node:20-alpine)
  ├── COPY --from=deps node_modules
  ├── COPY source
  ├── next build (standalone output)
  └── Output: .next/standalone, .next/static, public/

Stage 3: runner  (node:20-alpine)  ← FINAL IMAGE
  ├── COPY --from=builder standalone/
  ├── Non-root user: nextjs (uid 1001)
  ├── Port 3000
  └── CMD: node server.js
```

### Why Alpine?

| Metric | Debian-slim | Alpine |
|---|---|---|
| Base image size | ~180 MB | ~7 MB |
| Final image size | ~400 MB | ~150 MB |
| CVE surface area | High | Low |
| Build time | Slower | Faster |

### Why standalone output?

`next build` with `output: 'standalone'` produces a self-contained `server.js` that includes only the Node.js code needed to run the server — no `node_modules` copy required in the runner stage. This reduces the final image size by ~60%.

**Action required:** Add `output: 'standalone'` to `next.config.ts` (Week 2 task).

---

## 6. CI/CD Pipeline Design

```
GitHub Push
    │
    ▼
CodePipeline (per branch/environment)
    │
    ├── Stage 1: SOURCE
    │   └── GitHub v2 connection → S3 artifact
    │
    ├── Stage 2: BUILD (CodeBuild)
    │   ├── Pull secrets from SSM / Secrets Manager
    │   ├── docker build --build-arg NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=...
    │   ├── docker push ECR (:<commit-hash> + :latest)
    │   └── Output: imagedefinitions.json
    │
    ├── Stage 3: APPROVAL (staging + prod only)
    │   └── SNS → email notification → manual approve/reject
    │
    └── Stage 4: DEPLOY (ECS)
        └── ECS rolling update using imagedefinitions.json
```

### Pipeline per Environment

| Pipeline | Source Branch | Auto-Deploy | Approval |
|---|---|---|---|
| `weather-app-dev-pipeline` | `dev` | Yes | No |
| `weather-app-qa-pipeline` | `qa` | Yes | No |
| `weather-app-staging-pipeline` | `staging` | No | Yes |
| `weather-app-prod-pipeline` | `main` | No | Yes |

---

## 7. Infrastructure as Code Strategy

All AWS resources are managed via **CloudFormation**. Stack hierarchy:

```
infra/cloudformation/stacks/
├── ecr.yml          ← ECR repository (deploy once per env)
├── ecs.yml          ← VPC, ALB, ECS Cluster, Task Definition, Service
└── pipeline.yml     ← CodePipeline, CodeBuild, IAM roles, S3 artifact bucket
```

### Stack Dependency Order

```
ecr.yml
  └─► ecs.yml (depends on ECR repo URI output)
        └─► pipeline.yml (depends on ECS cluster + ECR outputs)
```

### Parameter Scoping

Every CloudFormation parameter is prefixed/tagged with `Environment` so the same template deploys to all 4 environments with different parameters:

```bash
aws cloudformation deploy \
  --template-file infra/cloudformation/stacks/ecs.yml \
  --stack-name weather-app-dev-ecs \
  --parameter-overrides file://infra/cloudformation/parameters/dev.json
```

---

## 8. Security Architecture

### Secrets Management Strategy

| Environment | Service | Why |
|---|---|---|
| dev, qa | SSM Parameter Store (SecureString) | Free, sufficient for non-prod |
| staging, prod | AWS Secrets Manager | Automatic rotation, audit trail |

### IAM Least Privilege

Each component gets its own IAM role with only required permissions:

| Role | Permissions |
|---|---|
| `CodeBuildRole-<env>` | ECR push/pull, SSM GetParameter, CloudWatch logs |
| `CodePipelineRole-<env>` | S3, CodeBuild start, ECS register task, SNS publish |
| `ECSTaskExecutionRole-<env>` | ECR pull, CloudWatch logs, SSM/Secrets read |
| `ECSTaskRole-<env>` | Application-specific permissions only |

### Container Security

- Non-root user (`nextjs`, uid 1001) in all containers
- Read-only root filesystem (Week 3 hardening)
- No secrets in Docker image layers — all injected at ECS task runtime
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is a restricted public token (URL-locked in Mapbox dashboard)

---

## 9. Cost Model

### Monthly Estimate (Free Tier aware)

| Service | Dev/QA | Staging/Prod | Notes |
|---|---|---|---|
| ECS Fargate | ~$0 | ~$15/mo | 0.25 vCPU / 0.5 GB → ~$0.01/hr |
| ECR | ~$0 | ~$1/mo | First 500 MB free |
| ALB | ~$0 | ~$16/mo | Free Tier: 750 hrs/mo first year |
| CodePipeline | ~$0 | ~$1/mo | 1 free pipeline/mo |
| CodeBuild | ~$0 | ~$1/mo | 100 build-min/mo free |
| SSM Param Store | $0 | $0 | Free for standard params |
| Secrets Manager | $0 | ~$0.80/mo | $0.40/secret/mo |
| CloudWatch Logs | ~$0 | ~$1/mo | 5 GB free |
| **Total** | **~$0** | **~$36/mo** | |

**Cost optimization levers:**
1. Set dev/qa tasks to 0 desired count outside business hours (saves ~70%)
2. Use ALB only for staging/prod; use direct ECS port mapping for dev/qa
3. Enable ECR lifecycle policies to delete images older than 14 days

---

## 10. Branching & Promotion Strategy

See `docs/BRANCHING.md` for the full diagram and workflow.

```
feature/* ──► dev ──► qa ──► staging ──► main
                                 ▲          ▲
                           Manual         Manual
                           Approval       Approval

hotfix/* ──────────────────► staging ──► main
                                   ▲
                             Expedited
                             Approval
```

---

## 11. Decisions Log (ADR)

### ADR-001: ECS Fargate over EC2

**Decision:** Use Fargate (serverless containers) instead of EC2-backed ECS.  
**Rationale:** No EC2 instance management, no capacity planning, per-second billing, compatible with Free Tier for small workloads.  
**Tradeoff:** Slightly higher per-task cost at scale vs. reserved EC2 instances.

### ADR-002: Alpine base image

**Decision:** `node:20-alpine` for all Docker stages.  
**Rationale:** ~150 MB final image vs ~400 MB Debian-slim. Smaller attack surface, faster ECR push/pull.  
**Tradeoff:** Musl libc vs glibc — some native Node modules need `libc6-compat`.

### ADR-003: SSM for dev/qa, Secrets Manager for staging/prod

**Decision:** Split secret stores by environment tier.  
**Rationale:** SSM Parameter Store is free; Secrets Manager adds cost ($0.40/secret/mo) but provides rotation and audit trails needed for production.  
**Tradeoff:** Slightly different CodeBuild env injection syntax per tier.

### ADR-004: Standalone Next.js output

**Decision:** Use `output: 'standalone'` in `next.config.ts`.  
**Rationale:** Removes `node_modules` from the runner container stage, cutting final image size by ~60%.  
**Tradeoff:** Requires `public/` and `.next/static` to be copied separately (handled in Dockerfile Stage 3).

### ADR-005: Per-environment CloudFormation stacks (not nested)

**Decision:** Flat stack per environment, not a single nested master stack.  
**Rationale:** Simpler blast radius, independent deploy/rollback per environment, avoids CloudFormation nested stack circular dependency issues.  
**Tradeoff:** More stacks to manage; mitigated by `deploy.sh` script.
