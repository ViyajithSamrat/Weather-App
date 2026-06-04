# High-Level Design — Enterprise Weather Application

**Version:** 3.0
**Date:** 2026-06-04
**Status:** Week 2 Complete — Dev deployed to AWS ap-south-1 (Mumbai)

---

## 1. Executive Summary

A production-grade weather dashboard built on Next.js 16 and deployed to AWS via a fully automated CDK pipeline. The architecture is:

- **Multi-environment**: dev → qa → staging → prod, each isolated in its own VPC
- **Free-tier compliant**: $0/month for all environments on AWS Free Tier
- **Security-first**: No port 22, secrets in SSM, non-root containers, IP-restricted access
- **Observable**: Container logs shipped to CloudWatch via awslogs driver (no SSH needed)
- **Parameterised**: Same CDK code deploys all 4 environments — only an `EnvConfig` object changes

---

## 2. Repository Architecture (Polyrepo)

```
GitHub: ViyajithSamrat
│
├── Weather-App            ← App code (Next.js, Docker, GitHub Actions)
│   └── Branches: main, Week-1, dev, qa, staging
│
└── Weather-App-IAC        ← Infrastructure code (AWS CDK TypeScript)
    └── Branches: main, Week-2
```

**Why polyrepo?**
- Independent review cycles: app and infra reviewed separately
- Separate access control: only DevOps engineers touch infrastructure
- Clean history: Dockerfile changes don't pollute the infra commit log

---

## 3. Application Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js | 16.1.6 | App Router, React Server Components |
| UI | React | 19.2.3 | Latest stable |
| Language | TypeScript | 5 | Strict mode |
| Styling | Tailwind CSS | 4 | JIT compiler |
| State | Zustand | 5 | Client-side unit/theme state |
| Maps | MapLibre GL | 4.0.0 | Open-source, no API key |
| Map tiles | OpenFreeMap | — | Keyless, free |
| Animation | Motion | 12 | Framer Motion fork |
| Weather API | OpenWeather | 2.5 | Free tier |
| UV Index | Open-Meteo | — | Free, no key |

---

## 4. Multi-Environment Architecture

### Environment Matrix

| Attribute | DEV | QA | STAGING | PROD |
|---|---|---|---|---|
| **Branch** | `dev` | `qa` | `staging` | `main` |
| **VPC CIDR** | 10.0.0.0/16 | 10.1.0.0/16 | 10.2.0.0/16 | 10.3.0.0/16 |
| **Instance** | t2.micro | t2.micro | t2.micro | t2.micro* |
| **AZs** | 1 | 1 | 1 | 1* |
| **Inbound** | Your IP/32 | Your IP/32 | Your IP/32 | 0.0.0.0/0 |
| **Deploy gate** | Auto | Auto | Manual approval | Manual approval |
| **Log retention** | 7 days | 7 days | 14 days | 30 days |
| **ECR images** | 3 | 3 | 5 | 10 |
| **SSM path** | /weather-app/dev/... | /weather-app/qa/... | /weather-app/staging/... | /weather-app/prod/... |
| **Monthly cost** | $0 | $0 | $0 | $0 |

*Upgrade to t3.small + 2 AZ when leaving free tier.

### Promotion Flow

```
Developer writes code
        │
        ▼
  feature/Week-X branch
        │  local test: docker compose up --build
        ▼
  main branch (merge Week-X)
        │
        ▼
  dev branch ──────────────► DEV  (auto-deploy, IP-restricted)
        │  smoke test passes
        ▼
  qa branch ───────────────► QA   (auto-deploy, IP-restricted)
        │  QA sign-off
        ▼
  staging branch ──────────► STAGING  (manual approval email → deploy)
        │  stakeholder approval
        ▼
  main branch ─────────────► PROD     (manual approval email → deploy)
```

---

## 5. AWS Infrastructure (per Environment)

### 5.1 Five CDK Stacks

```
weather-app-<env>-vpc        VPC + public subnet + IGW + S3 Gateway Endpoint (free)
weather-app-<env>-security   SG (IP-restricted HTTP only) + IAM role (least-privilege)
weather-app-<env>-ecr        ECR repo + scan-on-push + lifecycle rules
weather-app-<env>-ec2        t2.micro AL2023 + Elastic IP + Docker + deploy.sh
weather-app-<env>-pipeline   CodePipeline + CodeBuild + SNS approval (staging/prod)
```

### 5.2 Network (VPC Stack)

```
VPC 10.x.0.0/16
  └── Public Subnet /24 (AZ-a)
        ├── Internet Gateway (outbound + inbound, free)
        ├── S3 Gateway Endpoint (free — ECR layer pulls via AWS backbone)
        └── EC2 t2.micro
              └── Elastic IP (stable public URL, free when attached)
```

**Why no NAT Gateway?** Costs $32/month. EC2 in public subnet + IGW is functionally equivalent for a single-instance deployment.

**S3 Gateway Endpoint (free):** ECR stores Docker image layers in S3. Without the endpoint, each layer pull goes through the EC2's public IP. With it, traffic stays on the AWS backbone — ~40% faster Docker pulls and zero data-transfer charges.

### 5.3 Security (Security Stack)

| Control | Implementation |
|---|---|
| Inbound HTTP | Port 80 from `allowedIp` only (your /32 in dev/qa/staging, 0.0.0.0/0 in prod) |
| SSH | Port 22 CLOSED — shell access via SSM Session Manager only |
| EC2 IAM | ECR pull + SSM GetParameter (1 param) + CW Logs + SSM Core |
| Secrets | KMS SecureString in SSM Parameter Store |
| EBS volume | gp3, AES-256 encrypted, delete-on-termination |
| EC2 metadata | IMDSv2 required — protects against SSRF on metadata service |

### 5.4 Container Runtime (EC2 Stack + Construct)

```
EC2 (Amazon Linux 2023)
  └── Docker daemon
        └── weather-app container
              ├── Image: ECR weather-app-<env>:latest
              ├── Port mapping: 80 → 3000
              ├── OPENWEATHER_API_KEY: from SSM at deploy time
              ├── Restart policy: unless-stopped
              └── Logs: awslogs → CloudWatch /weather-app/<env>/app
```

View container logs from anywhere (no SSH):
```bash
aws logs tail /weather-app/dev/app --follow --region ap-south-1
```

### 5.5 CI/CD Pipeline (Pipeline Stack)

```
git push origin <branch>
        │  GitHub webhook (CodeConnections)
        ▼
CodePipeline
  ├─ SOURCE: pull code from GitHub branch
  │
  ├─ APPROVE (staging/prod only):
  │    SNS email → human approves in AWS Console
  │
  └─ BUILD (CodeBuild SMALL):
       pre_build:  ECR login, extract 7-char commit SHA as IMAGE_TAG
       build:      docker build --cache-from :latest  (60% faster on hit)
                   docker tag :IMAGE_TAG + :latest
       post_build: docker push both tags
                   aws ssm send-command → EC2 /opt/deploy.sh
                   poll ssm get-command-invocation (30×15s = 7.5min max)
                   print deploy result table
```

**Bug fixes applied to pipeline (Week 2 → v2):**
1. `restartExecutionOnUpdate: false` — was `true`, caused every `cdk deploy` to trigger an app deploy
2. `--cache-from :latest` — Docker layer cache; was missing, causing full rebuilds every run
3. Removed unused `ListCommandInvocations` IAM action
4. SSM poll now waits 7.5 min (was 5 min), handles Cancelled status explicitly
5. Added `|| true` on `docker pull :latest` for cache — first deploy has no prior image

---

## 6. Container Image

### Multi-Stage Dockerfile

```
Stage 1: deps    (public.ecr.aws/docker/library/node:20-alpine)
  └── npm install → /app/node_modules

Stage 2: builder (public.ecr.aws/docker/library/node:20-alpine)
  ├── COPY node_modules from deps
  ├── COPY weather-app/ source
  └── npm run build → .next/standalone (self-contained server.js)

Stage 3: runner  (public.ecr.aws/docker/library/node:20-alpine)  ← FINAL
  ├── Non-root: nextjs uid 1001, nodejs gid 1001
  ├── COPY only .next/standalone, .next/static, public/
  ├── EXPOSE 3000
  ├── HEALTHCHECK: wget / (30s, 5s timeout, 15s start, 3 retries)
  └── CMD: ["node", "server.js"]

Final image: ~150 MB
```

**Why ECR public mirror?** Docker Hub rate-limits CodeBuild (429 Too Many Requests). `public.ecr.aws/docker/library/node:20-alpine` is the official AWS mirror — no rate limits, lower latency from ap-south-1.

---

## 7. Observability

### Currently Available (Week 2)

| Signal | Where | How to Access |
|---|---|---|
| Container stdout/stderr | CloudWatch `/weather-app/<env>/app` | `aws logs tail <group> --follow` |
| Build logs | CloudWatch `/aws/codebuild/weather-app-<env>-build` | CodeBuild console |
| Deploy status | SSM Run Command history | SSM console → Run Command |
| Pipeline status | CodePipeline console | AWS Console |

### Planned Week 3

| Signal | Tool | Threshold |
|---|---|---|
| EC2 CPU | CloudWatch Alarm | > 80% for 5 min → SNS alert |
| CodeBuild failure | CloudWatch Alarm | any failure → SNS alert |
| App 5xx errors | CW Logs metric filter | > 5/min → alarm |
| App response time | CW Logs metric filter | > 2s p99 → alarm |

---

## 8. Secrets Management

```
Developer (one-time, per environment)
        │
        ▼  ./scripts/seed-ssm.sh <env> <api-key>
        │
  SSM Parameter Store
  /weather-app/<env>/OPENWEATHER_API_KEY
  Type: SecureString (KMS encrypted)
        │
        ▼  At container start: aws ssm get-parameter --with-decryption
        │
  docker run -e OPENWEATHER_API_KEY="$KEY"
        │
        ▼
  Next.js Server Action: process.env.OPENWEATHER_API_KEY
  (server-side only, never in NEXT_PUBLIC_* or client bundle)
```

The API key is **never** in: git history, Dockerfile, Docker image layers, CloudFormation templates, CodeBuild logs, or client-side JavaScript.

---

## 9. IAM Least-Privilege Summary

| Role | Actions | Resource Scope |
|---|---|---|
| EC2 role | ECR GetAuthToken + BatchGetImage + GetDownloadURL | 1 repo ARN |
| EC2 role | SSM GetParameter, GetParameters | 1 parameter ARN |
| EC2 role | KMS Decrypt | * with condition: ViaService=ssm.region.amazonaws.com |
| EC2 role | CW Logs: CreateLogGroup/Stream, PutLogEvents, DescribeLogStreams | /weather-app/<env>/app* |
| EC2 role | AmazonSSMManagedInstanceCore | Managed policy |
| CodeBuild role | ECR push/pull (6 actions) | 1 repo ARN |
| CodeBuild role | SSM SendCommand | 1 instance ARN + AWS-RunShellScript doc ARN |
| CodeBuild role | SSM GetCommandInvocation | * (unsupported resource restriction) |

---

## 10. Cost Model

All environments run at **$0/month** on AWS Free Tier:

| Service | Free Tier Limit | Usage |
|---|---|---|
| EC2 t2.micro | 750 hrs/month (12 months) | 1 instance per env |
| EBS gp3 8 GB | 30 GB/month | 8 GB per env |
| Elastic IP | Free when attached | 1 per env |
| ECR | 500 MB/month | < 200 MB per env (3 images × ~60 MB) |
| CodePipeline | 1 active pipeline free | 1 per env |
| CodeBuild SMALL | 100 min/month | ~5 min per deploy |
| SSM Parameter Store | Standard tier free | 1 SecureString per env |
| CloudWatch Logs | 5 GB free | < 100 MB/month |
| S3 Gateway Endpoint | Always free | 1 per VPC |

---

## 11. Architecture Decision Records (ADRs)

| ADR | Decision | Rationale |
|---|---|---|
| 001 | EC2 t2.micro over ECS Fargate | Fargate = $15/mo min. t2.micro = free tier. |
| 002 | No ALB in dev/qa | ALB = $16/mo. Direct Elastic IP is free. ALB added with HTTPS in Week 3 for staging/prod. |
| 003 | CDK TypeScript over raw CFN | Compile-time type safety. Reusable constructs. No copy-paste between environments. |
| 004 | Alpine base image | ~150 MB final vs ~600 MB Debian. Smaller CVE surface. |
| 005 | Next.js standalone output | Removes node_modules from runner stage. 60% image size reduction. |
| 006 | MapLibre GL + OpenFreeMap | No Mapbox account required. Identical API. No billing surprises. |
| 007 | SSM Run Command for deploy | No CodeDeploy agent, no extra cost, auditable, idempotent. |
| 008 | SSM Session Manager | Port 22 closed. Full audit trail in CloudTrail. No SSH key management. |
| 009 | ECR public mirror for base image | Docker Hub rate-limits CodeBuild (429). ECR public has no limit, lower latency in Mumbai. |
| 010 | awslogs Docker driver | Container logs in CloudWatch without SSH. Searchable with Insights. |
| 011 | S3 Gateway VPC Endpoint | Free. Routes ECR pulls through AWS backbone. ~40% faster builds. |
| 012 | CDK context var for env selection | `--context deploy-env=prod` selects environment. Prevents accidental prod deploys from `--all`. |
| 013 | SNS manual approval for staging/prod | Email notification forces a human to review before deploying to sensitive environments. |
| 014 | Polyrepo architecture | App and infra on separate review/deploy cycles. Independent access control. Industry standard. |

---

## 12. Week Roadmap

| Week | Deliverables | Status |
|---|---|---|
| 1 | Next.js app, MapLibre maps, Docker multi-stage, GitHub Actions CI | COMPLETE |
| 2 | CDK 5-stack IaC, 4 envs parameterised, ap-south-1, IP restriction, CW logs, deployed | COMPLETE |
| 3 | HTTPS/ALB (staging/prod), CloudWatch Alarms, security headers, structured logging, QA deploy | PLANNED |
| 4 | Secrets Manager (prod), load test, on-call runbook, staging/prod deploy, Route53 domain | PLANNED |
