# Enterprise Weather App — DevOps Platform

A production-grade weather dashboard built on **Next.js 19** and deployed to **AWS** via a fully automated CDK pipeline. Built as a DevOps internship project demonstrating enterprise practices within the AWS Free Tier.

**Live demo:** `http://<EC2-ELASTIC-IP>` (port 80, ap-south-1)

---

## Architecture Overview

```
feature/* → dev branch → DEV EC2 (auto-deploy)
                   ↓
              PR to main
                   ↓
         GitHub Actions: Production Gate
         ├── Vitest unit tests    [BLOCKING]
         ├── Playwright E2E       [BLOCKING]
         ├── pytest smoke         [BLOCKING]
         └── SonarCloud           [informational]
                   ↓
              merge to main
                   ↓
         CodePipeline (prod) → SNS approval email
                   ↓
              PROD EC2 (public)
```

**2 environments:** `dev` (IP-restricted, auto-deploy) + `prod` (public, manual approval)
**Infrastructure:** AWS CDK TypeScript — 5 stacks per environment
**Cost:** $0/month (AWS Free Tier)

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 16.1.6 (App Router) |
| UI | React 19, TypeScript 5, Tailwind CSS 4 |
| State | Zustand 5 |
| Maps | MapLibre GL + OpenFreeMap (no API key) |
| Weather | OpenWeather API 2.5 (free tier) |
| Container | Docker multi-stage, Node 20 Alpine |
| Registry | AWS ECR (private, scan-on-push) |
| Compute | EC2 t2.micro, Amazon Linux 2023 |
| IaC | AWS CDK TypeScript (5 stacks) |
| CI/CD | GitHub Actions + AWS CodePipeline + CodeBuild |
| Secrets | AWS SSM Parameter Store (KMS SecureString) |
| Logging | CloudWatch Logs (awslogs Docker driver) |
| Quality | Vitest + Playwright + pytest + SonarCloud |

---

## Repository Structure (Polyrepo)

```
ViyajithSamrat/Weather-App         ← This repo (app code + CI/CD)
ViyajithSamrat/Weather-App-IAC     ← CDK infrastructure code
```

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/ViyajithSamrat/Weather-App
cd Weather-App/weather-app
npm install

# 2. Set your OpenWeather API key
cp .env.example .env.local
# Edit .env.local: OPENWEATHER_API_KEY=your_key_here

# 3. Run in dev mode
npm run dev
# Open http://localhost:3000

# 4. Or run in Docker (matches production exactly)
cd ..
docker compose up --build
# Open http://localhost
```

---

## Running Tests

All tests run automatically via GitHub Actions on every PR to `main`.

```bash
cd weather-app

# Unit tests (Vitest)
npm run test:coverage

# E2E tests (Playwright — requires running server)
npm run build && npm run start &
npm run test:e2e

# Smoke tests (pytest — requires running server)
cd ..
pip install -r tests/requirements.txt
pytest tests/ -v
```

---

## AWS Deployment

### Prerequisites

```bash
# 1. Install CDK CLI
npm install -g aws-cdk@latest

# 2. Configure AWS credentials (ap-south-1)
aws configure

# 3. Clone IAC repo
git clone https://github.com/ViyajithSamrat/Weather-App-IAC
cd Weather-App-IAC
npm install
```

### Deploy Dev Environment

```bash
# One-time bootstrap (first time only)
npx cdk bootstrap aws://911167912708/ap-south-1

# Deploy all 5 stacks
npx cdk deploy --all --context deploy-env=dev --require-approval never

# Seed the API key into SSM
./scripts/seed-ssm.sh dev YOUR_OPENWEATHER_API_KEY

# Push code to trigger first deploy
git push origin dev
```

### Deploy Prod Environment

```bash
npx cdk deploy --all --context deploy-env=prod --require-approval never
./scripts/seed-ssm.sh prod YOUR_OPENWEATHER_API_KEY
# Pipeline waits for SNS approval email before deploying
```

---

## CI/CD Pipeline — How It Works

### Development Flow (dev branch)

1. `git push origin dev`
2. CodeConnections webhook → CodePipeline triggers in < 1 second
3. CodeBuild: ECR login → docker build (with layer cache) → ECR push → SSM RunCommand
4. EC2 `/opt/deploy.sh`: pull :latest → read API key from SSM → docker run
5. App live at `http://dev-elastic-ip` in ~4 minutes

### Production Flow (main branch)

1. Open PR: `dev → main`
2. GitHub Actions `prod-gate.yml` runs automatically
3. All checks must be green (unit tests, E2E, smoke)
4. Human reviews PR → merges
5. CodePipeline triggers → pauses at APPROVE stage
6. SNS email sent to `samratviyajith@gmail.com`
7. Human clicks Approve in AWS Console
8. CodeBuild: build → push → SSM deploy to prod EC2
9. App live at `http://prod-elastic-ip` in ~6 minutes

---

## Security Model

| Control | Implementation |
|---|---|
| Port 22 | **Never opened** — SSM Session Manager only |
| API key | SSM SecureString (KMS encrypted) — never in git/image/buildspec |
| Container user | Non-root (uid 1001) |
| EC2 metadata | IMDSv2 required (SSRF protection) |
| EBS | AES-256 encrypted, gp3 |
| Network | VPC Flow Logs, restricted egress, S3 Gateway Endpoint |
| Images | ECR scan-on-push for CVEs |
| Access (dev) | Developer IP /32 only |
| Access (prod) | 0.0.0.0/0 (public weather app) |

---

## CDK Infrastructure (5 Stacks)

```
weather-app-<env>-vpc        VPC + public subnet + S3 Endpoint + Flow Logs
weather-app-<env>-security   Security Group (no port 22) + IAM (least-privilege)
weather-app-<env>-ecr        ECR + scan-on-push + lifecycle (keep last 3/10)
weather-app-<env>-ec2        EC2 t2.micro + Elastic IP + deploy.sh
weather-app-<env>-pipeline   CodePipeline + CodeBuild + SSM deploy + SNS gate
```

Deploy command: `npx cdk deploy --all --context deploy-env=<dev|prod>`

---

## Documentation

| Document | Description |
|---|---|
| [docs/HLD.md](docs/HLD.md) | Full high-level design with architecture diagrams |
| [docs/BRANCHING.md](docs/BRANCHING.md) | Git branching strategy and developer workflow |
| [docs/RELEASE_GOVERNANCE.md](docs/RELEASE_GOVERNANCE.md) | Enterprise release workflow, approval model |
| [docs/PRODUCTION_SOP.md](docs/PRODUCTION_SOP.md) | Step-by-step production deployment procedure |
| [docs/ROLLBACK_SOP.md](docs/ROLLBACK_SOP.md) | Rollback procedures for all failure scenarios |
| [docs/MONITORING.md](docs/MONITORING.md) | Observability strategy, alerting plan |

---

## Architecture Decision Records (Key)

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Compute | EC2 t2.micro | ECS Fargate | Fargate ~$15/month; t2.micro free tier |
| Load balancer | None (direct IP) | ALB | ALB ~$16/month; planned for Week 4 |
| IaC | CDK TypeScript | Raw CloudFormation | Type safety, reusable constructs |
| Base image | ECR public mirror | Docker Hub | Docker Hub rate-limits CodeBuild |
| Deploy | SSM RunCommand | CodeDeploy | No agent cost, full audit trail |
| Shell access | SSM Session Manager | SSH (port 22) | Zero open ports, CloudTrail audit |
| Quality gate | GitHub Actions | CodePipeline stage | Gate blocks BEFORE merge; no wasted build minutes |
| Static analysis | SonarCloud | Self-hosted SonarQube | t2.micro has 1 GB RAM; SonarQube needs 2 GB |
| Testing | Vitest | Jest | Native ESM; zero config for Next.js esnext/bundler |
| Maps | MapLibre + OpenFreeMap | Mapbox | No API key, no billing, identical API |

---

## Troubleshooting

### App not loading in browser

```bash
# 1. Is EC2 running?
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=weather-app-dev" \
  --query "Reservations[*].Instances[*].{State:State.Name,IP:PublicIpAddress}" \
  --region ap-south-1

# 2. Is your IP in the security group?
curl https://checkip.amazonaws.com
# Then update security group if IP changed:
# AWS Console → EC2 → Security Groups → weather-app-dev-ec2-sg → Edit inbound rules

# 3. Is container running?
# SSM Session Manager → EC2 → docker ps; docker logs weather-app --tail 50
```

### Pipeline not triggering

```bash
# 1. Verify CodeConnections status
aws codepipeline get-pipeline-state \
  --name weather-app-dev-pipeline \
  --region ap-south-1

# 2. Manual trigger
aws codepipeline start-pipeline-execution \
  --name weather-app-dev-pipeline \
  --region ap-south-1
```

### Unit tests failing in CI

```bash
# Run locally first to see actual error
cd weather-app
npm run test:coverage
# Fix the failing test, push again
```

### Production Gate failing on SonarCloud

SonarCloud is **informational only** — the production gate passes even if SonarCloud fails/skips. This is by design: SonarCloud requires a valid `SONAR_TOKEN` in GitHub Secrets.

---

## Week Roadmap

| Week | Focus | Status |
|---|---|---|
| 1 | Next.js app + Docker multi-stage + GitHub Actions lint/type-check | ✅ Complete |
| 2 | CDK 5-stack IaC + dev/prod environments + ap-south-1 + CW logs | ✅ Complete |
| 3 | Production Gate (Vitest + Playwright + pytest + SonarCloud) | ✅ Complete |
| 4 | CloudWatch Alarms + HTTPS/ALB + structured logging + prod deploy demo | Planned |
| 5 | Auto Scaling + multi-AZ + WAF + performance benchmarks | Planned |

---

*Built on AWS Free Tier — $0/month operational cost.*
*Region: ap-south-1 (Mumbai) — closest Indian AWS region.*
