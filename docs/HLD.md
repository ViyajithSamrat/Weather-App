# High-Level Design — Enterprise Weather Application DevOps Platform

**Version:** 4.0
**Date:** 2026-06-19
**Status:** Active — Dev deployed, Production gate operational
**Strategy:** 2-environment model (dev + prod) per mentor direction

---

## 1. Executive Summary

A production-grade weather dashboard built on Next.js 19 and deployed to AWS via a fully automated CDK pipeline. The architecture demonstrates enterprise DevOps practices within the AWS Free Tier ($0/month).

**Core design principles:**
- **2-environment model**: `dev` for development validation, `prod` for public release
- **Gate-before-promote**: GitHub Actions Production Gate blocks broken code from ever reaching `main`
- **Zero-trust security**: No port 22, no hardcoded secrets, no root containers
- **Observable by default**: Container logs in CloudWatch, build logs in CodeBuild, deploy audit in SSM
- **Infrastructure-as-code**: Same CDK TypeScript deploys dev and prod — only an `EnvConfig` object differs
- **Free-tier compliant**: $0/month across all active environments

---

## 2. Architecture Overview

### 2.1 End-to-End Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│  DEVELOPER MACHINE                                                         │
│  git push origin dev                                                       │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  GITHUB (ViyajithSamrat/Weather-App)                                       │
│                                                                            │
│  dev branch push                                                           │
│    └─► CodeConnections webhook ──────────────────────────────────────────► │
│                                                                            │
│  PR: dev → main                                                            │
│    └─► GitHub Actions: prod-gate.yml                                       │
│          ├── Job 1: Vitest (unit tests + coverage)   [BLOCKING]            │
│          ├── Job 2: Playwright E2E + pytest smoke    [BLOCKING]            │
│          ├── Job 3: SonarCloud analysis              [informational]       │
│          └── Job 4: Production Gate (required)       [branch protection]  │
│                ✓ All pass → PR can merge to main                           │
│                ✗ Any fail → PR blocked                                     │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ CodeConnections webhook
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  AWS — ap-south-1 (Mumbai)                                                 │
│                                                                            │
│  DEV ENVIRONMENT (auto-deploy on every push to dev)                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CodePipeline: weather-app-dev-pipeline                             │   │
│  │  [SOURCE] ──► [BUILD]                                               │   │
│  │                 CodeBuild SMALL                                     │   │
│  │                 1. ECR login                                        │   │
│  │                 2. docker build --cache-from :latest                │   │
│  │                 3. docker push :sha + :latest to ECR                │   │
│  │                 4. SSM RunCommand → EC2 /opt/deploy.sh             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  PROD ENVIRONMENT (manual approval required)                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CodePipeline: weather-app-prod-pipeline                            │   │
│  │  [SOURCE] ──► [APPROVE] ──► [BUILD]                                 │   │
│  │                 │              CodeBuild SMALL                      │   │
│  │               SNS email        docker build → ECR → SSM deploy     │   │
│  │               to approver                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ECR (per env)     SSM Parameter Store      CloudWatch Logs                │
│  :latest + :sha    /weather-app/<env>/      /weather-app/<env>/app         │
│                    OPENWEATHER_API_KEY                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.2 Branch → Environment Mapping

```
feature/* branch
    │ local dev: docker compose up --build
    │ unit tests pass locally
    ▼
dev branch ──────► DEV CodePipeline ──► EC2 dev  (auto, IP-restricted)
    │
    │ PR: dev → main
    │ Production Gate runs (Vitest + Playwright + pytest + SonarCloud)
    │ All must pass → human reviews → merge approved
    ▼
main branch ─────► PROD CodePipeline ─► [SNS APPROVAL EMAIL]
                                             │ human clicks Approve
                                             ▼
                                        EC2 prod (public, port 80)
```

---

### 2.3 Secrets Flow

```
Developer (one-time per environment)
    │  ./scripts/seed-ssm.sh <env> <api-key>
    ▼
SSM Parameter Store (KMS SecureString)
/weather-app/dev/OPENWEATHER_API_KEY
/weather-app/prod/OPENWEATHER_API_KEY
    │  EC2 instance role reads at deploy time only
    ▼
aws ssm get-parameter --with-decryption
    │
    ▼
docker run -e OPENWEATHER_API_KEY="$KEY"
    │
    ▼
Next.js Server Actions (server-side only — never in client bundle)

Key is NEVER in: git, Dockerfile, image layers, buildspec, CloudFormation, client JS
```

---

### 2.4 Docker Multi-Stage Image

```
Stage 1: deps  (public.ecr.aws/docker/library/node:20-alpine)
  COPY package.json package-lock.json
  RUN npm ci → node_modules/

Stage 2: builder  (node:20-alpine)
  COPY node_modules/ from stage 1
  COPY weather-app/ source
  RUN npm run build → .next/standalone/

Stage 3: runner  (node:20-alpine)  ← FINAL IMAGE (~150 MB)
  User: nextjs uid 1001 (non-root)
  COPY .next/standalone, .next/static, public/
  EXPOSE 3000
  HEALTHCHECK: wget localhost:3000 (30s interval)
  CMD ["node", "server.js"]

No node_modules. No build tools. No source code in final image.
ECR public mirror (no Docker Hub rate limits in ap-south-1 CodeBuild)
```

---

## 3. Repository Architecture (Polyrepo)

| Repo | Purpose | Language |
|---|---|---|
| `ViyajithSamrat/Weather-App` | App code, Docker, GitHub Actions | Next.js/TypeScript |
| `ViyajithSamrat/Weather-App-IAC` | AWS CDK infrastructure | CDK TypeScript |

**Why polyrepo?**
- Independent review cycles — app PRs don't require infra review and vice versa
- Separate access control — only DevOps engineers touch infrastructure
- Isolated deployment pipelines — app code changes never accidentally re-deploy infra

**Local paths:**
- App: `C:\project\Weather App`
- IAC: `C:\project\Weather-App-IAC`

---

## 4. Application Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js | 16.1.6 | App Router, React Server Components |
| UI | React | 19.2.3 | Latest stable |
| Language | TypeScript | 5 | Strict mode |
| Styling | Tailwind CSS | 4 | JIT compiler |
| State | Zustand | 5 | Client-side city/unit state |
| Maps | MapLibre GL | 4.0.0 | Open-source, no API key |
| Map tiles | OpenFreeMap | — | Free, no registration |
| Animation | Motion | 12 | Framer Motion fork |
| Weather API | OpenWeather | 2.5 | Free tier: 60 calls/min |
| UV Index | Open-Meteo | — | Free, no key |

---

## 5. AWS Infrastructure (per environment)

### 5.1 Five CDK Stacks

```
weather-app-<env>-vpc        VPC + public subnet + S3 Gateway Endpoint + Flow Logs
weather-app-<env>-security   Security Group (IP-restricted) + IAM roles (least-privilege)
weather-app-<env>-ecr        ECR repo + scan-on-push + lifecycle rules
weather-app-<env>-ec2        EC2 t2.micro + Elastic IP + Docker + /opt/deploy.sh
weather-app-<env>-pipeline   CodePipeline + CodeBuild + SSM deploy + SNS approval (prod)
```

Stack deployment order: `vpc → security → ecr → ec2 → pipeline`

### 5.2 Network (VPC Stack)

```
VPC 10.x.0.0/16  (dev: 10.0.0.0/16, prod: 10.3.0.0/16)
  └── Public Subnet /24 in ap-south-1b
        ├── Internet Gateway (outbound + inbound)
        ├── S3 Gateway Endpoint (free — ECR layer pulls via AWS backbone)
        └── EC2 t2.micro + Elastic IP
```

No NAT Gateway ($32/month). EC2 in public subnet with IGW is equivalent for single-instance deployments.

### 5.3 Security (Security Stack)

| Control | Implementation |
|---|---|
| Inbound HTTP | Port 80 from `allowedIp` (dev: your /32, prod: 0.0.0.0/0) |
| SSH | Port 22 **never opened** — SSM Session Manager only |
| EC2 IAM | ECR pull + SSM GetParameter (1 param ARN) + CW Logs + SSM Core |
| Secrets | KMS SecureString in SSM Parameter Store |
| EBS | gp3, AES-256 encrypted, delete-on-termination |
| EC2 metadata | IMDSv2 required (blocks SSRF against metadata endpoint) |
| Container | Non-root user (nextjs uid 1001) |

### 5.4 Container Runtime (EC2 Construct)

```
EC2 (Amazon Linux 2023, ap-south-1b)
  Docker daemon
    └── weather-app container
          Image:   ECR weather-app-<env>:latest
          Port:    80 → 3000
          API key: Injected at deploy time from SSM (never baked into image)
          Restart: --restart unless-stopped
          Logs:    awslogs → CloudWatch /weather-app/<env>/app

Deploy script (/opt/deploy.sh):
  1. ECR login via instance role
  2. docker pull :latest
  3. Read OPENWEATHER_API_KEY from SSM at runtime
  4. docker rm -f old container
  5. docker run new container with -e flag injection
```

### 5.5 CI/CD Pipeline (Pipeline Stack)

```
CodePipeline
  Stage 1: SOURCE   → CodeConnections webhook → download from GitHub
  Stage 2: APPROVE  → (prod only) SNS email to approver
  Stage 3: BUILD    → CodeBuild SMALL
    pre_build:  ECR login; IMAGE_TAG=$(cut -c1-7 from CODEBUILD_RESOLVED_SOURCE_VERSION)
    build:      docker pull :latest || true (cache); docker build --cache-from :latest
    post_build: docker push :IMAGE_TAG + :latest
                aws ssm send-command → EC2 /opt/deploy.sh
                Poll get-command-invocation (30 × 15s = 7.5 min max)
                Print result table (Status, Output, Error)
```

### 5.6 ECR Image Tagging

| Tag | Value | Purpose |
|---|---|---|
| `:latest` | Always newest | EC2 pulls this for every deploy |
| `:<sha>` | 7-char git commit SHA | Immutable audit trail and rollback reference |

Lifecycle rules:
- dev: keep last 3 tagged images, expire untagged after 1 day
- prod: keep last 10 tagged images (wider rollback window)

---

## 6. Quality Gates

### 6.1 Production Gate (GitHub Actions — prod-gate.yml)

Runs on every PR from `dev` → `main`. PR cannot merge unless all required jobs are green.

| Job | Framework | Tests | Blocks merge? |
|---|---|---|---|
| unit-tests | Vitest | 11 unit tests + 60% coverage threshold | Yes |
| e2e-and-smoke | Playwright | 9 E2E tests (homepage + API routes) | Yes |
| e2e-and-smoke | pytest | 9 smoke tests (homepage + geocode + tile API) | Yes |
| sonarcloud | SonarCloud | Static analysis + security hotspots | No (informational) |
| production-gate | Evaluator | Aggregates above results | Yes (required check) |

**Critical rule:** `secrets` context MUST NOT appear in job-level `if:` conditions — causes 0-second workflow failure. Use step-level env var checks instead.

### 6.2 Test Suite Details

**Vitest (unit)** — `weather-app/__tests__/units.test.ts`
- `convertTemp`: 0°C→32°F, 100°C→212°F, -40 edge case, passthrough
- `convertWindSpeed`: m/s, km/h, mph, knots
- `convertPressure`: hPa, inHg
- `convertDistance`: km, miles
- `convertPrecipitation`: mm, inches

**Playwright (E2E)** — `weather-app/e2e/`
- `homepage.spec.ts`: HTTP 200, HTML content type, app name, lat/lon params
- `sidebar.spec.ts`: Geocode API (empty, missing param, valid query), Tile API (invalid layer 400, valid layer)

**pytest (smoke)** — `tests/test_smoke.py`
- Homepage: 200, HTML content type, "Vertex" in body
- Geocode API: short query, missing param, valid query, empty string
- Tile API: invalid layer 400, valid layer 200/500

### 6.3 Coverage Thresholds

Configured in `vitest.config.ts`:
```
lines:     60%
functions: 60%
branches:  60%
```

Target files: `lib/weather/**`, `lib/utils.ts`, `lib/constants/weather-emoji.ts`

---

## 7. 2-Environment Matrix

| Attribute | DEV | PROD |
|---|---|---|
| **Branch** | `dev` | `main` |
| **VPC CIDR** | 10.0.0.0/16 | 10.3.0.0/16 |
| **AZ** | ap-south-1b | ap-south-1b |
| **Instance** | t2.micro | t2.micro* |
| **Inbound** | 122.183.51.230/32 | 0.0.0.0/0 |
| **Deploy** | Auto on push | Manual SNS approval |
| **Log retention** | 7 days | 30 days |
| **ECR images kept** | 3 | 10 |
| **SSM path** | /weather-app/dev/... | /weather-app/prod/... |
| **Gate** | None (fast iteration) | Production Gate + SNS approval |
| **Cost** | $0 | $0 |

*Upgrade to t3.small + 2 AZ + ALB + ACM (HTTPS) when leaving free tier.

---

## 8. Observability

### Currently Available

| Signal | Source | How to access |
|---|---|---|
| Container stdout/stderr | CloudWatch `/weather-app/<env>/app` | `aws logs tail <group> --follow --region ap-south-1` |
| Build logs | CloudWatch `/aws/codebuild/weather-app-<env>-build` | CodeBuild console |
| Deploy status | SSM Run Command history | SSM console → Run Command → History |
| Pipeline state | CodePipeline | AWS Console → CodePipeline |
| VPC traffic | CloudWatch `/weather-app/<env>/vpc-flow-logs` | CloudWatch Logs Insights |
| ECR scan results | ECR console | Repository → Images → Vulnerabilities |

### Planned (Week 3)

| Signal | Implementation | Threshold |
|---|---|---|
| EC2 CPU alarm | CloudWatch Alarm → SNS | > 80% for 5 min |
| CodeBuild failure | CloudWatch Events → SNS | Any failure |
| App 5xx rate | CW Logs metric filter | > 5/min |
| Response time | CW Logs metric filter | p99 > 2s |

---

## 9. Rollback Strategy

| Scenario | Recovery action | Time to restore |
|---|---|---|
| Bad container deploy | SSM Session Manager → `docker run <repo>:<prev-sha>` | < 2 min |
| Bad pipeline run | CodePipeline → disable transition + push revert commit | < 5 min |
| Infrastructure broken | `npx cdk deploy --all --context deploy-env=<env>` | < 10 min |
| Nuclear option | `cdk destroy --all --force` then `cdk deploy --all` | < 25 min |

ECR keeps 10 tagged images for prod — always ≥9 previous versions available for rollback.

See `docs/ROLLBACK_SOP.md` for step-by-step procedures.

---

## 10. Secrets Management

The OpenWeather API key is the only secret. It flows exclusively through SSM.

```
NEVER: git, Dockerfile ENV, docker --build-arg, buildspec env var,
       CloudFormation, Lambda env, NEXT_PUBLIC_* (client-side)

ALWAYS: SSM SecureString → instance role reads at container start
        → docker run -e OPENWEATHER_API_KEY="$KEY"
        → Next.js process.env (server-side only)
```

Local development: `.env.local` (gitignored). Confirmed in `.gitignore`.
Production: SSM SecureString in ap-south-1.

---

## 11. IAM Least-Privilege Summary

| Role | Action | Resource scope |
|---|---|---|
| EC2 role | ECR pull (3 actions) | 1 repo ARN |
| EC2 role | SSM GetParameter | 1 parameter ARN |
| EC2 role | KMS Decrypt | * with condition ViaService=ssm.region.amazonaws.com |
| EC2 role | CW Logs (4 actions) | /weather-app/<env>/app log group |
| EC2 role | AmazonSSMManagedInstanceCore | Managed policy |
| CodeBuild role | ECR push/pull (6 actions) | 1 repo ARN |
| CodeBuild role | SSM SendCommand | 1 instance ARN + RunShellScript doc ARN |
| CodeBuild role | SSM GetCommandInvocation | * (no resource restriction supported) |

---

## 12. Cost Model

**Target: $0/month**

| Service | Free tier | Per-env usage |
|---|---|---|
| EC2 t2.micro | 750 hrs/month (12 mo) | 720 hrs/month |
| EBS gp3 8 GB | 30 GB/month | 8 GB |
| Elastic IP | Free when attached | 1 per env |
| ECR | 500 MB | < 200 MB (3–10 images × ~60 MB) |
| CodePipeline | 1 free pipeline | 1 per env |
| CodeBuild SMALL | 100 min/month | ~2 min/build |
| SSM Parameter Store | Standard tier free | 1 SecureString |
| CloudWatch Logs | 5 GB free ingest | < 100 MB/month |
| S3 Gateway Endpoint | Always free | 1 per VPC |

---

## 13. Architecture Decision Records

| ADR | Decision | Rationale |
|---|---|---|
| 001 | EC2 t2.micro over ECS Fargate | Fargate ≈ $15/month min. t2.micro = free tier. |
| 002 | No ALB in dev/prod | ALB ≈ $16/month. Direct Elastic IP. ALB added in Week 3 with HTTPS. |
| 003 | CDK TypeScript over raw CloudFormation | Compile-time safety, reusable constructs, no per-env copy-paste. |
| 004 | Alpine base image | ~150 MB final vs ~600 MB Debian. Smaller CVE surface. |
| 005 | Next.js standalone output | Removes node_modules from runner stage. 60% image size reduction. |
| 006 | MapLibre GL + OpenFreeMap | No Mapbox account or billing surprises. Identical API. |
| 007 | SSM RunCommand for deploy | No CodeDeploy agent. Free. Auditable. Idempotent. |
| 008 | SSM Session Manager | Port 22 closed. Full CloudTrail audit. No SSH key management. |
| 009 | ECR public mirror for base image | Docker Hub rate-limits CodeBuild (429). ECR public = no limit. |
| 010 | awslogs Docker driver | Container logs in CloudWatch without any SSH access. |
| 011 | S3 Gateway VPC Endpoint | Free. ECR layer pulls via AWS backbone. ~40% faster. |
| 012 | 2-env model (dev + prod) | Mentor direction. GitHub Flow pattern. Sufficient for portfolio scale. |
| 013 | SNS manual approval for prod only | Email gate forces human review before any production deploy. |
| 014 | Polyrepo architecture | App and infra on independent review and deployment cycles. |
| 015 | Vitest over Jest | Native ESM. Zero config for esnext/bundler moduleResolution. |
| 016 | SonarCloud over self-hosted | t2.micro 1 GB RAM < SonarQube 2 GB minimum. Cloud-hosted is free for public repos. |
| 017 | GitHub Actions for quality gate | Gate runs BEFORE merge. If it fails, qa/prod branch never receives broken code. |

---

## 14. Week Roadmap

| Week | Deliverables | Status |
|---|---|---|
| 1 | Next.js app, MapLibre, Docker multi-stage, GitHub Actions CI (lint/type-check) | COMPLETE |
| 2 | CDK 5-stack IaC, 2 envs (dev+prod), ap-south-1, Elastic IP, CW logs, deployed | COMPLETE |
| 3 | Production Gate (Vitest + Playwright + pytest + SonarCloud), branch protection | COMPLETE |
| 4 | CloudWatch Alarms, HTTPS/ALB (prod), structured logging, production deploy demo | PLANNED |
