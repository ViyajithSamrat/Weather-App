# Enterprise Weather Application — High Level Design (HLD)

**Version:** 2.0  
**Date:** 2026-05-28  
**Author:** DevOps Platform Team  
**Status:** Week 2 Complete — CDK Dev Environment

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

This document describes the end-to-end DevOps platform for the **Enterprise Weather Application** — a Next.js 16 / React 19 weather dashboard containerised with Docker and deployed on AWS EC2 via an automated CodePipeline CI/CD system managed entirely through **AWS CDK TypeScript**.

The platform provides:
- **4 fully isolated environments** (dev → qa → staging → prod) — **dev implemented in Week 2; QA/staging/prod designed and ready to deploy**
- **Immutable, container-based deployments** via ECR + EC2 t2.micro (free tier)
- **Infrastructure as Code** via AWS CDK TypeScript (compiles to CloudFormation — zero manual console work)
- **Least-privilege security** (IAM, SSM Parameter Store, no hardcoded credentials, no open SSH)
- **100% AWS Free Tier** for the dev environment — zero cloud cost

---

## 2. Application Analysis

| Property | Value |
|---|---|
| Framework | Next.js 16.1.6 |
| Runtime | React 19.2.3 (RSC + Server Actions) |
| Language | TypeScript 5 |
| CSS | Tailwind CSS 4 |
| State | Zustand 5 |
| Maps | MapLibre GL (open-source, no API key) |
| Map tiles | OpenFreeMap (free, keyless) |
| Build output | `.next/standalone` (self-contained Node server) |
| Default port | 3000 |
| Node target | 20 LTS |

### External API Dependencies

| API | Env Var | Side | Secret Store (dev) |
|---|---|---|---|
| OpenWeather | `OPENWEATHER_API_KEY` | Server-only | SSM Parameter Store (SecureString) |
| OpenFreeMap base tiles | — | Client | No key required |

### Key Architectural Notes

- **`OPENWEATHER_API_KEY`** is server-side only — injected at container runtime from SSM. Never in `NEXT_PUBLIC_*`, never in the Docker image, never in git.
- The app uses **Next.js Server Actions** and two **proxy API routes** (`/api/weather/[layer]/...` for tile overlays, `/api/geocode` for city search) so the key never reaches the browser.
- **MapLibre GL** (open-source Mapbox fork, identical API) renders maps with **OpenFreeMap** tiles — no third-party API key required client-side. Mapbox was removed entirely.
- Build output uses `output: 'standalone'` — the `server.js` entry does not require a separate Next.js installation in the runner image, cutting the final Docker image size by ~60%.

---

## 3. Architecture Overview

### DEV Environment (Week 2 — Implemented)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AWS CLOUD  (us-east-1)                             │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  VPC  (weather-app-dev-vpc)  10.0.0.0/16                            │  │
│  │                                                                      │  │
│  │  ┌─────────────────────────────────────────────────────────────┐    │  │
│  │  │  PUBLIC SUBNET  (1x AZ — free tier, no NAT needed)          │    │  │
│  │  │                                                              │    │  │
│  │  │  ┌──────────────────────────────────────────────────────┐   │    │  │
│  │  │  │  EC2 t2.micro  (Amazon Linux 2023)                   │   │    │  │
│  │  │  │  ├─ Docker: weather-app container → port 3000        │   │    │  │
│  │  │  │  ├─ Elastic IP  (stable public address)              │   │    │  │
│  │  │  │  ├─ SSM Agent  (Session Manager + Run Command)       │   │    │  │
│  │  │  │  └─ SG: inbound port 80 only, no port 22            │   │    │  │
│  │  │  └──────────────────────────────────────────────────────┘   │    │  │
│  │  └─────────────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CI/CD Platform                                                      │   │
│  │                                                                      │   │
│  │  GitHub ──► CodePipeline ──► CodeBuild ──► ECR push                 │   │
│  │                                │                                     │   │
│  │               Source Stage     └──► SSM Run Command                  │   │
│  │               Build Stage           → EC2: /opt/deploy.sh            │   │
│  │               (build + push              (docker pull + restart)      │   │
│  │                + SSM deploy)                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
│  │  ECR              │  │  SSM Param Store │  │  CloudWatch Logs     │    │
│  │  weather-app-dev  │  │  /weather-app/   │  │  CodeBuild logs      │    │
│  │  (max 3 images)   │  │  dev/OWM_KEY     │  │  7-day retention     │    │
│  └───────────────────┘  └──────────────────┘  └──────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

  Developer ──► GitHub ──► EC2 Elastic IP :80 ──► Next.js :3000 ──► OpenWeather API
                                                                  └──► OpenFreeMap (keyless)
```

### Future Environments (QA / Staging / Prod — Designed, Not Yet Deployed)

QA and staging/prod will follow the same CDK pattern. Adding them requires only:
1. A new `config/qa.ts` (or `staging.ts` / `prod.ts`) implementing `EnvConfig`
2. One `deployEnvironment(app, qaConfig)` call in `bin/weather-app.ts`

Staging/prod may introduce a NAT Gateway, higher instance types, and a manual approval stage in the pipeline — all configurable via `EnvConfig` fields.

---

## 4. Environment Strategy

| Environment | Branch | Purpose | Instance | Status |
|---|---|---|---|---|
| **dev** | `dev` | Active development + CI/CD validation | t2.micro (free) | **Implemented (Week 2)** |
| **qa** | `qa` | QA / automated testing | t2.micro (free) | Designed — deploy Week 3+ |
| **staging** | `staging` | Pre-prod validation | t3.small | Designed — deploy Week 3+ |
| **prod** | `main` | Live production | t3.small | Designed — deploy Week 4 |

Each environment gets **fully isolated** AWS resources (separate VPC, ECR repo, EC2, pipeline, SSM namespace) via the CDK `EnvConfig` pattern.

---

## 5. Container Strategy

### Multi-Stage Dockerfile

```
Stage 1: deps    (node:20-alpine)
  └── npm install
      └── Output: /app/node_modules

Stage 2: builder (node:20-alpine)
  ├── COPY --from=deps node_modules
  ├── COPY source
  ├── next build (standalone output)
  └── Output: .next/standalone, .next/static, public/

Stage 3: runner  (node:20-alpine)  ← FINAL IMAGE
  ├── COPY --from=builder standalone/
  ├── Non-root user: nextjs (uid 1001)
  ├── HEALTHCHECK via wget (Alpine default)
  ├── Port 3000
  └── CMD: node server.js
```

### Image Size Targets

| Stage | Target | Max |
|---|---|---|
| `deps` | < 400 MB | 600 MB |
| `builder` | < 800 MB | 1.2 GB |
| `runner` (final) | < 180 MB | 250 MB |

### Why Alpine?

| Metric | Debian-slim | Alpine |
|---|---|---|
| Base image | ~180 MB | ~7 MB |
| Final image | ~400 MB | ~150 MB |
| CVE surface | High | Low |

### Why standalone output?

`output: 'standalone'` produces a self-contained `server.js` with no `node_modules` needed in the runner — cuts final image by ~60%.

---

## 6. CI/CD Pipeline Design

```
GitHub Push (to `dev` branch)
    │
    ▼
CodePipeline (weather-app-dev-pipeline)
    │
    ├── Stage 1: SOURCE
    │   └── GitHub CodeStar connection → artifact
    │
    └── Stage 2: BUILD (CodeBuild SMALL — free tier)
        ├── docker build -t <repo>:<commit> -t <repo>:latest
        ├── ECR login + push :commit + :latest
        └── aws ssm send-command → EC2 /opt/deploy.sh
                                      ├── ECR pull :latest
                                      ├── SSM get OPENWEATHER_API_KEY
                                      └── docker run (restart container)
```

**No separate Deploy stage** — the build stage handles both push and SSM-driven deploy. For staging/prod an explicit `ManualApprovalAction` stage will be inserted (hook is commented in `pipeline-stack.ts`).

---

## 7. Infrastructure as Code Strategy

All AWS resources are managed via **AWS CDK TypeScript** (`infra/cdk/`). CDK synthesises CloudFormation templates — zero raw YAML maintained by hand.

### CDK Project Structure

```
infra/cdk/
├── bin/
│   └── weather-app.ts            ← App entry: wires all stacks per env
├── config/
│   ├── env-config.ts             ← EnvConfig interface (the multi-env contract)
│   └── dev.ts                    ← DEV values (only env deployed in Week 2)
├── lib/
│   ├── constructs/
│   │   └── docker-ec2-construct.ts   ← Reusable EC2+Docker+EIP+UserData
│   └── stacks/
│       ├── vpc-stack.ts          ← VPC + public subnet + IGW
│       ├── security-stack.ts     ← Security group + EC2 IAM role
│       ├── ecr-stack.ts          ← ECR repo + lifecycle rules
│       ├── ec2-stack.ts          ← t2.micro instance + ECR pull grant
│       └── pipeline-stack.ts     ← CodePipeline + CodeBuild + S3 artifacts
└── scripts/
    └── seed-ssm.sh               ← One-time secret seeding (out-of-band)
```

### Stack Dependency Order (CDK resolves automatically)

```
vpc-stack
  └─► security-stack (needs vpc)
  └─► ec2-stack      (needs vpc + security + ecr)
        └─► pipeline-stack (needs ecr + instance id)
ecr-stack (independent)
```

### Multi-Environment Readiness

Adding QA/Staging/Prod later requires **zero changes to stack files**:

```typescript
// bin/weather-app.ts — just add one line per new environment:
deployEnvironment(app, devConfig);     // Week 2 ✓
deployEnvironment(app, qaConfig);      // Week 3
deployEnvironment(app, stagingConfig); // Week 3
deployEnvironment(app, prodConfig);    // Week 4
```

### Key Commands

```bash
cd infra/cdk && npm install

# One-time per account:
npx cdk bootstrap aws://<ACCOUNT>/us-east-1

# One-time: create GitHub CodeStar connection in console, paste ARN into config/dev.ts
# One-time: seed the API key into SSM:
./scripts/seed-ssm.sh dev <OPENWEATHER_API_KEY>

# Deploy:
npx cdk deploy --all --require-approval never

# Destroy (clean — no orphaned resources):
npx cdk destroy --all --force
```

---

## 8. Security Architecture

### Secrets Management

| Environment | Service | Why |
|---|---|---|
| dev, qa | SSM Parameter Store (SecureString) | Free, sufficient for non-prod |
| staging, prod | AWS Secrets Manager | Automatic rotation, audit trail |

The API key is **never** in code, git history, Docker image layers, or environment blocks — it lives only in SSM and is read at container-start time via the EC2 instance role.

### IAM Least Privilege

| Role | Permissions |
|---|---|
| `weather-app-dev-ec2-role` | ECR pull (scoped to dev repo), SSM GetParameter (scoped to one param ARN), KMS Decrypt via SSM, AmazonSSMManagedInstanceCore |
| CodeBuild role (auto-generated) | ECR push/pull (scoped to dev repo), SSM SendCommand (scoped to one instance + AWS-RunShellScript doc), SSM GetCommandInvocation, CloudWatch logs |
| CodePipeline role (auto-generated) | S3 artifact read/write, CodeBuild start, CodeStar connection use |

### Container Security

- Non-root user (`nextjs`, uid 1001) in all containers
- No port 22 open — shell access via **SSM Session Manager** (no inbound firewall rule required)
- No secrets in Docker image layers — all injected at container runtime
- No client-side API keys: maps use keyless OpenFreeMap; OWM key stays server-side only

---

## 9. Cost Model

### DEV Environment — Monthly Estimate (AWS Free Tier)

| Service | Config | Monthly Cost |
|---|---|---|
| EC2 t2.micro | 750 free hours/month | **$0** |
| EBS gp3 8 GB | 30 GB free | **$0** |
| Elastic IP | attached to running instance | **$0** |
| VPC + IGW | no NAT Gateway | **$0** |
| ECR | ≤ 3 images, < 500 MB free | **$0** |
| CodePipeline | 1 pipeline (1 free/month) | **$0** |
| CodeBuild SMALL | < 100 min/month free | **$0** |
| SSM Param Store | standard parameters | **$0** |
| CloudWatch Logs | < 5 GB free | **$0** |
| **DEV Total** | | **$0/month** |

Cost avoided by architectural choices:
- **No ECS Fargate**: saves ~$15/mo per environment
- **No ALB**: saves ~$16/mo per environment
- **No NAT Gateway**: saves ~$32/mo per environment

---

## 10. Branching & Promotion Strategy

See `docs/BRANCHING.md` for the full diagram and workflow.

### Current Model (Week-Based Isolation)

```
main  (baseline — initial commit only until all weeks pass QA)
  │
  ├── Week-1  (Docker + Next.js app — pending merge after API key test)
  │
  └── Week-2  (CDK IaC, dev env only — pending merge after Week-1)
```

Each week branch is isolated from `main`. After the user tests and approves, the week branch merges to `main` and the next week's branch is cut from the updated `main`.

### Future Promotion Flow (Weeks 3–4)

```
feature/* ──► dev ──► qa ──► staging ──► main
                                ▲             ▲
                          Manual           Manual
                          Approval         Approval
```

---

## 11. Decisions Log (ADR)

### ADR-001: EC2 t2.micro over ECS Fargate

**Decision:** Use a t2.micro EC2 instance instead of ECS Fargate for the dev environment.  
**Rationale:** Fargate has no free tier — even 0.25 vCPU costs ~$9/mo. t2.micro gives 750 free hours/month. For a single-container dev environment with no HA requirement, EC2 is the cost-optimal choice.  
**Tradeoff:** Manual scaling; no rolling deploy (container restarts via SSM instead). Staging/prod will use a higher-tier instance or revisit ECS.

### ADR-002: No ALB in Dev

**Decision:** EC2 Elastic IP exposed directly on port 80, no Application Load Balancer.  
**Rationale:** ALB costs ~$16/mo regardless of traffic. For dev, a static EIP on port 80 achieves the same result at $0.  
**Tradeoff:** No HTTPS/TLS in dev (HTTP only). Staging/prod will add an ALB with ACM cert.

### ADR-003: CDK over raw CloudFormation

**Decision:** All IaC is AWS CDK TypeScript. No hand-written CloudFormation YAML.  
**Rationale:** Type safety catches errors at compile time (not after a 10-min CFN rollback). Reusable constructs (`DockerEc2Construct`) eliminate copy-paste YAML across environments. `EnvConfig` interface enforces the multi-env contract at the TypeScript level.  
**Tradeoff:** CDK bootstrap stack required once per account/region. Slightly higher tool complexity vs raw CFN.

### ADR-004: Alpine base image

**Decision:** `node:20-alpine` for all Docker stages.  
**Rationale:** ~150 MB final image vs ~400 MB Debian-slim. Smaller attack surface, faster ECR push/pull.  
**Tradeoff:** Musl libc — some native Node modules need `libc6-compat` (already installed in deps stage).

### ADR-005: Standalone Next.js output

**Decision:** `output: 'standalone'` in `next.config.ts`.  
**Rationale:** Removes `node_modules` from runner stage, cutting final image size by ~60%. `CMD node server.js` — no Next.js CLI needed in the container.  
**Tradeoff:** `public/` and `.next/static` must be copied separately (handled in Dockerfile Stage 3).

### ADR-006: MapLibre GL + OpenFreeMap (no Mapbox)

**Decision:** Replace Mapbox GL JS with MapLibre GL and serve base tiles from OpenFreeMap.  
**Rationale:** Mapbox requires a credit card and billing even on the free tier. MapLibre GL is an open-source drop-in fork with an identical API. OpenFreeMap is fully free and keyless — nothing to bake into the client bundle.  
**Tradeoff:** OpenFreeMap style URLs differ from Mapbox — one-time migration, no ongoing cost.

### ADR-007: SSM Run Command for EC2 Deploy (no CodeDeploy)

**Decision:** CodeBuild post_build runs `aws ssm send-command` to invoke `/opt/deploy.sh` on the EC2 box.  
**Rationale:** No CodeDeploy agent needed, no `appspec.yml`, no additional IAM setup. The deploy script (written by UserData at boot) is idempotent: pull `:latest`, stop old container, start new one. Simpler and free.  
**Tradeoff:** No blue/green or rolling deploy — single container stops briefly during `docker rm`. Acceptable for dev; staging/prod can introduce CodeDeploy or ECS.

### ADR-008: SSM Session Manager (no open port 22)

**Decision:** Security group has no inbound port 22. Shell access is via SSM Session Manager.  
**Rationale:** Open SSH is a common attack vector. Session Manager provides authenticated shell access through the AWS console/CLI with full audit logging, requiring zero inbound firewall rules.  
**Tradeoff:** Requires SSM agent on the instance (pre-installed on Amazon Linux 2023).
