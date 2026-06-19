# Enterprise Release Governance
# Production Readiness Architecture — Weather App DevOps Platform

**Author:** Enterprise Release Engineer / Senior SRE
**Version:** 1.0
**Date:** 2026-06-19
**Strategy:** 2-environment model (dev + prod) — GitHub Flow adapted for AWS CodePipeline

---

## 1. Release Philosophy

This project implements **GitHub Flow** with an enterprise-grade approval layer. It deliberately uses 2 environments (dev + prod) rather than a full 4-stage pipeline (dev → qa → staging → prod). This is a deliberate architectural decision, not a shortcut:

- **Speed of iteration**: fewer promotion gates means faster developer feedback
- **Portfolio scale**: the project has 1 developer — a 4-env chain adds overhead without proportional quality gain
- **Still enterprise-grade**: the Production Gate (automated tests) + SNS manual approval + CodePipeline audit trail meet the bar for governance even with 2 environments

> **Mentor note:** A real enterprise with 50 engineers would add qa and staging. The CDK configs for those environments exist (`config/qa.ts`, `config/staging.ts`) and can be re-enabled in one line. The pattern is identical — only the number of active environments differs.

---

## 2. Promotion Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RELEASE PROMOTION FLOW                                   │
│                                                                             │
│  Developer writes code                                                      │
│         │                                                                   │
│         ▼                                                                   │
│   feature/* branch                                                          │
│   (local only, no deploy)                                                   │
│         │  docker compose up --build (local validation)                    │
│         │  npm run test:coverage (unit tests locally)                      │
│         ▼                                                                   │
│   dev branch ──────────────────────────► DEV EC2 (auto, IP-restricted)     │
│         │  CodePipeline auto-deploys                                        │
│         │  Developer validates on http://dev-elastic-ip                    │
│         │                                                                   │
│         │  [RELEASE DECISION: ready for production?]                       │
│         │                                                                   │
│         │  gh pr create --base main --head dev                             │
│         ▼                                                                   │
│  GitHub Actions: prod-gate.yml                                             │
│         ├── Vitest unit tests (11 tests, 60% coverage)    ← BLOCKING       │
│         ├── Playwright E2E (9 tests, Chromium)            ← BLOCKING       │
│         ├── pytest smoke (9 tests, HTTP surface)          ← BLOCKING       │
│         └── SonarCloud (static analysis, security)        ← informational  │
│         │                                                                   │
│         │  Production Gate (required) = GREEN                              │
│         │  Human reviews PR diff → approves → merges                       │
│         ▼                                                                   │
│   main branch ─────────────────────────► PROD CodePipeline triggers        │
│                                          SNS email: samratviyajith@gmail.com│
│                                          Human clicks Approve in AWS Console│
│                                          CodeBuild → docker build → deploy  │
│                                          PROD EC2 (public, port 80)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Environment Configuration

| Property | DEV | PROD |
|---|---|---|
| Branch | `dev` | `main` |
| AWS VPC CIDR | 10.0.0.0/16 | 10.3.0.0/16 |
| EC2 instance | t2.micro | t2.micro |
| Access | 122.183.51.230/32 (developer only) | 0.0.0.0/0 (public) |
| Deploy trigger | Auto on push | Manual SNS approval |
| Log retention | 7 days | 30 days |
| ECR images | Last 3 | Last 10 (wider rollback window) |
| SSM param path | /weather-app/dev/... | /weather-app/prod/... |
| Tag mutability | MUTABLE (overwrite :latest) | MUTABLE (overwrite :latest) |

---

## 4. Approval Governance Model

### Level 1: Automated Gate (Production Gate — GitHub Actions)

Runs on every PR: `dev` → `main`. No human can bypass this — branch protection enforces it.

```
Required status check: "Production Gate (required)"
Source: prod-gate.yml job "production-gate"
Enforcement: GitHub Settings → Branches → main → require status checks
```

What it validates:
- All unit tests pass (no regression in converters, utils, constants)
- All E2E tests pass (browser renders correctly, API routes respond correctly)
- All smoke tests pass (server HTTP surface is intact)
- Coverage threshold met (≥60% lines, functions, branches)

### Level 2: Human Code Review (Pull Request)

After the gate passes, a human must review and merge the PR.

Reviewer checklist:
- [ ] No secrets or API keys in the diff
- [ ] No hardcoded IPs or environment-specific values outside config files
- [ ] Docker build would produce a functionally equivalent image
- [ ] No `set -x` added to shell scripts (would leak SSM-decrypted secrets)
- [ ] Coverage not artificially inflated by trivial tests

### Level 3: Production Deployment Approval (AWS CodePipeline SNS)

After merge to `main`, CodePipeline starts but PAUSES at the Approve stage.

SNS email is sent to: `samratviyajith@gmail.com`

Approver checklist (before clicking Approve in AWS Console):
- [ ] Confirm PR review was completed (not an emergency bypass)
- [ ] Check DEV is healthy: `curl http://dev-elastic-ip` returns 200
- [ ] Check ECR has the new image: `aws ecr describe-images --repository-name weather-app-prod`
- [ ] Confirm no active incidents in CloudWatch alarms
- [ ] Time: avoid deploying on Fridays or during peak usage hours

Approval window: 7 days (CodePipeline default). After 7 days, the execution expires and must be re-triggered.

---

## 5. Deployment Architecture

### 5.1 Blue/Green Concepts Applied

This project uses an **in-place rolling replacement** approach (not true Blue/Green, which requires two complete sets of infrastructure). However, the same safety properties are achieved:

```
Current state: weather-app container running, serving traffic on port 80

Deploy sequence (/opt/deploy.sh):
  1. docker pull :latest          ← new image downloaded while old runs
  2. docker rm -f weather-app     ← old container stopped (30s grace)
  3. docker run weather-app       ← new container starts immediately
  4. --restart unless-stopped     ← survives EC2 reboots

Gap: ~2-5 seconds between old stop and new start.
Health check in HEALTHCHECK directive catches startup failures.
```

**Why not true Blue/Green?** Requires two EC2 instances or an ALB, adding $16-32/month. At t2.micro free-tier scale, a ~3 second restart is acceptable. Week 4 plan: add ALB + ACM for prod (enables true zero-downtime).

### 5.2 Canary Concepts Applied

Full canary (routing X% of traffic to new version) requires an ALB or service mesh — out of scope at t2.micro. The DEV environment serves as the canary proxy:

```
DEV = canary environment:
  New code is deployed to DEV and validated before prod.
  Developer manually tests on DEV (IP-restricted).
  Only then is a PR opened to promote to PROD.

This is "human-in-the-loop canary" — a valid enterprise pattern for
low-traffic internal tools and portfolio projects.
```

Week 4+ upgrade path: ALB weighted target groups for true canary (90% old / 10% new).

### 5.3 Why Approval Gates Matter

| Without gate | With gate |
|---|---|
| Broken code reaches prod in 4 minutes | Broken code blocked at PR; prod never touched |
| Rollback requires SSM intervention | No rollback needed — bad code never shipped |
| Silent failures in converters | Caught by Vitest in 30 seconds |
| API route regression goes to prod | Caught by Playwright/pytest before merge |
| No audit trail | Every deploy traceable: git commit SHA → ECR tag → SSM command ID |

---

## 6. Release Management

### 6.1 Release Cadence

| Type | Frequency | Process |
|---|---|---|
| Feature release | Ad-hoc (when dev is ready) | Full flow: dev → gate → PR → SNS approval → prod |
| Hotfix | On-demand | Same flow, faster — fix on dev, gate, PR, expedited approval |
| Infrastructure change | Weekly | CDK diff review → deploy dev → validate → deploy prod |

### 6.2 Release Naming

Not formally versioned (portfolio project). Each release is identified by:
- Git commit SHA (7 chars): `abc1234`
- ECR image tag: `weather-app-prod:abc1234`
- CodeBuild build number: `weather-app-prod-build:#42`
- SSM Command ID: `a1b2c3d4-...` (CloudTrail audit trail)

For production visibility: add git tags:
```bash
git tag -a v1.0.0 -m "Week 3 complete: production gate + monitoring"
git push origin v1.0.0
```

### 6.3 Deployment Risk Classification

| Risk level | Examples | Process |
|---|---|---|
| Low | UI text change, new weather card, docs | Standard flow |
| Medium | New API route, dependency bump, new env var | Standard flow + smoke test verification |
| High | Dockerfile change, CDK stack change, SSM param rotation | CDK diff review + manual verification on DEV |
| Critical | Security patch | Expedited flow + immediate SNS approval |

---

## 7. Monitoring Readiness

### 7.1 Currently Observable

| Signal | Tool | Access |
|---|---|---|
| Container logs | CloudWatch Logs `/weather-app/<env>/app` | `aws logs tail <group> --follow` |
| Build logs | CloudWatch `/aws/codebuild/weather-app-<env>-build` | CodeBuild console |
| Deploy history | SSM Run Command history | SSM Console |
| Pipeline status | CodePipeline | AWS Console |
| VPC traffic | CloudWatch `/weather-app/<env>/vpc-flow-logs` | CW Logs Insights |
| ECR scan | ECR console | Repository → Images → Vulnerabilities |

### 7.2 Week 4 — Alerting Plan

```
CloudWatch Alarm: EC2 CPU > 80% for 5 min
  → SNS Topic → Email: samratviyajith@gmail.com
  Action: scale horizontally (Week 5) or restart container

CloudWatch Alarm: CodeBuild FAILED
  → SNS Topic → Email
  Action: investigate build logs

CloudWatch Metric Filter: HTTP 5xx > 5/min
  Pattern: [..status=5*, ...]
  → Alarm → SNS → Email
  Action: check container logs, consider rollback

CloudWatch Metric Filter: Response time > 2s (p99)
  → Alarm (warning, not paging)
  Action: investigate slow API calls
```

### 7.3 Production Readiness Checklist

- [x] Container logs shipped to CloudWatch (awslogs driver)
- [x] Build logs in CloudWatch (CodeBuild default)
- [x] Deploy history auditable (SSM Run Command + CloudTrail)
- [x] EC2 accessible without SSH (SSM Session Manager)
- [x] Container restarts on crash (--restart unless-stopped)
- [x] Container survives EC2 reboot (same flag)
- [x] API key never in logs (set -x absent from deploy.sh)
- [x] Non-root container user (nextjs uid 1001)
- [x] IMDSv2 enforced (blocks SSRF)
- [x] EBS encrypted (gp3 AES-256)
- [x] Port 22 closed (SSM only)
- [ ] CloudWatch Alarms (Week 4)
- [ ] HTTPS / ACM cert (Week 4)
- [ ] Structured logging (JSON format) (Week 4)
- [ ] Health check endpoint /api/health (Week 4)

---

## 8. Security Considerations

### 8.1 Secret Management

| Secret | Storage | Access |
|---|---|---|
| OPENWEATHER_API_KEY | SSM SecureString (KMS) | EC2 instance role only |
| SONAR_TOKEN | GitHub Secrets | GitHub Actions runner only |
| OPENWEATHER_API_KEY (local) | .env.local (gitignored) | Developer only |

Rules enforced architecturally:
- `set -x` never used in deploy.sh (would log decrypted key in SSM)
- No `--build-arg` for secrets (would appear in `docker history`)
- No `NEXT_PUBLIC_*` prefix on API key (would ship to browser)
- IAM role scoped to single parameter ARN (not /weather-app/*)

### 8.2 Network Security

```
Inbound DEV:  Port 80 from 122.183.51.230/32 only
Inbound PROD: Port 80 from 0.0.0.0/0 (public weather app)
Inbound:      Port 22 NEVER OPEN
Egress:       443 (AWS APIs + OpenWeather), 80 (dnf updates), 53 UDP (DNS)
VPC:          Flow logs enabled, S3 Gateway Endpoint
EC2:          IMDSv2 required, gp3 AES-256 EBS, non-root container
```

### 8.3 Supply Chain

- ECR `imageScanOnPush: true` — every push scans for CVEs
- `public.ecr.aws/docker/library/node:20-alpine` — AWS-hosted mirror (not Docker Hub)
- `npm ci --frozen-lockfile` in CI — locked dependency versions
- SonarCloud — static analysis for security hotspots

---

## 9. High Availability Discussion

### Current State (Free Tier)

```
Single EC2 t2.micro in ap-south-1b
  Availability: ~99.5% (EC2 SLA)
  Recovery: --restart unless-stopped (crash → restart in seconds)
  SPOF: single AZ, single instance
```

### Production Upgrade Path

When leaving free tier, add:

```
Week 4: Application Load Balancer + ACM (HTTPS, $16/month)
         → blue/green deploys with zero downtime
         → SSL termination at the ALB

Week 5: Auto Scaling Group (min 2, max 4)
         → multi-AZ (ap-south-1b + ap-south-1c)
         → true HA with CloudWatch scaling

Week 6: ECS Fargate (if container management overhead grows)
         → ~$15/month base but no EC2 management
         → rolling deployments built-in
```

### ECS Fargate vs EC2 Tradeoff

| Factor | EC2 t2.micro | ECS Fargate |
|---|---|---|
| Cost | $0 (free tier) | ~$15/month min |
| Management | You manage Docker, deploy.sh | AWS manages scheduling |
| Scaling | Manual ASG config | Auto scales by task count |
| Deploy zero-downtime | Needs ALB | Built-in rolling |
| Startup time | ~30s (docker run) | ~90s (task provisioning) |
| Portfolio value | Shows infrastructure knowledge | Shows managed service usage |
| Recommendation | ✓ Use now (free tier, more to demo) | Migrate in Week 6 |

---

## 10. Incident Response Basics

### Severity Classification

| Severity | Definition | Response time | Examples |
|---|---|---|---|
| P0 | Production down, all users affected | Immediate | 500 on homepage, container crash |
| P1 | Major feature broken | 30 min | API key expired, geocode returning 502 |
| P2 | Minor degradation | 4 hours | Map tiles slow, slow search |
| P3 | Cosmetic / non-blocking | Next business day | UI misalignment, outdated text |

### P0 Response Playbook

```
1. DETECT: CloudWatch alarm or user report
   └── aws logs tail /weather-app/prod/app --follow --region ap-south-1

2. CONTAIN: Stop traffic (if ALB exists) or update security group to block port 80
   └── aws ec2 modify-security-group-rules ... (close port 80 temporarily)

3. DIAGNOSE: Check container status
   └── SSM Session Manager → EC2 → docker ps; docker logs weather-app --tail 100

4. ROLLBACK: Pull last known good image
   └── See docs/ROLLBACK_SOP.md → Section 1 (Container Rollback)

5. VERIFY: Smoke test after rollback
   └── curl -I http://prod-elastic-ip
   └── pytest tests/ -v (if server accessible)

6. POST-MORTEM: Document within 24h
   └── Root cause, timeline, fix, prevention
```

---

## 11. Deployment Flow — Final Architecture Summary

```
CODE                  GATE                  DEPLOY               TRAFFIC
────                  ────                  ──────               ───────

feature/* branch                                                  (none)
     │
     ▼ merge to dev
dev branch ──────────────────────────► DEV EC2
     │                                 auto, 4min               developer IP
     │
     ▼ PR to main
GitHub Actions ─────────────────────── (no deploy)
  prod-gate.yml:
  ├── Vitest [BLOCK]
  ├── Playwright [BLOCK]
  ├── pytest [BLOCK]
  └── SonarCloud [INFO]
     │
     ▼ gate passes + human merges
main branch                                                       (pending)
     │
     ▼ CodePipeline SOURCE stage
     │
     ▼ CodePipeline APPROVE stage
SNS email ──────────────────────────── human approval             (pending)
     │
     ▼ approved
CodeBuild BUILD stage ──────────────► PROD EC2                   0.0.0.0/0
  docker build + push                  ~4-6 min total            (public)
  SSM RunCommand
```

**Total time from PR merge to production live: ~6-8 minutes**
(2 min CodePipeline trigger + 2 min build + 2 min deploy + email latency)
