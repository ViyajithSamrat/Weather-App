# Branching Strategy & Git Flow

**Version:** 2.0  
**Date:** 2026-05-28

---

## Core Model — Week-Based Isolation

Each week of the project lives on its own branch isolated from `main`. The user tests that week's deliverables, approves, and the branch merges to `main`. The next week's branch is then cut from the updated `main`. This gives clean, reviewable history and prevents weeks from interfering with each other.

```
main  (clean baseline — only merged, tested weeks)
  │
  ├── Week-1   (Docker + Next.js app)
  ├── Week-2   (AWS CDK IaC — dev environment)
  ├── Week-3   (planned — monitoring, HTTPS, QA env)
  └── Week-4   (planned — staging/prod, full pipeline)
```

### Week Branch Lifecycle

```
1. Cut branch from main (after previous week is merged)
2. Build the week's deliverables
3. Test locally / validate
4. User approves: "merge"
5. Merge to main via fast-forward (no open PR needed for solo work)
6. Delete the week branch remotely (optional — keeps remote clean)
7. Repeat
```

---

## Current Branch State (2026-05-28)

| Branch | Base | Status | Contains |
|---|---|---|---|
| `main` | — | Baseline (initial commit) | README, .gitignore |
| `Week-1` | main | **Pending merge** (awaiting final API test) | Docker, Next.js app, MapLibre, OWM free-tier |
| `Week-2` | main | **Pushed, pending Week-1 merge** | CDK TypeScript IaC (dev env only) |

**Merge order:** `Week-1` → `main` first, then `Week-2` → `main`. When both are on `main`, the pipeline (CDK) can build the app (Dockerfile).

---

## Merge Command (when user approves)

```bash
# Merge Week-1 to main
git checkout main
git merge --no-ff Week-1 -m "merge: Week-1 — Docker + Next.js app"
git push origin main

# Then merge Week-2
git merge --no-ff Week-2 -m "merge: Week-2 — CDK IaC dev environment"
git push origin main
```

---

## Future Environment Branch Map (Weeks 3–4)

Once QA/staging/prod environments are built (Weeks 3–4), the branch-to-environment mapping will be:

```
BRANCH          ENVIRONMENT     AUTO-DEPLOY     APPROVAL GATE
─────────────── ─────────────── ─────────────── ──────────────
feature/*       (local only)    No              No
dev             DEV             Yes             No
qa              QA              Yes             No
staging         STAGING         No              Yes (manual)
main            PRODUCTION      No              Yes (manual)
hotfix/*        (local only)    No              No
```

### Future Promotion Flow

```
  DEVELOPER                GIT BRANCHES                   AWS ENVIRONMENTS
  ─────────                ────────────                   ────────────────

  $ git checkout           feature/add-wind-card
    -b feature/...               │
                                 │  PR review
                                 ▼
                            dev branch  ──────────────►  DEV  (auto-deploy)
                                 │
                                 │  PR + integration tests
                                 ▼
                             qa branch  ──────────────►  QA   (auto-deploy)
                                 │
                                 │  PR + QA sign-off
                                 ▼
                          staging branch  ─────────►  STAGING (manual approval)
                                 │
                                 │  PR + stakeholder approval
                                 ▼
                            main branch  ─────────►  PRODUCTION (manual approval)
```

---

## Branch Protection Rules (apply when team expands)

### `main`
- Require PR with ≥ 1 reviewer (solo: ≥ 0 for solo work)
- Require all CI checks to pass (GitHub Actions: lint + typecheck + Docker build)
- No direct push
- Linear history enforced

### `Week-N` branches
- No restrictions during active development week
- Delete after successful merge to `main`

### `staging` / `prod` (future)
- Require PR with ≥ 1 reviewer
- Require CI + Trivy scan to pass
- Require CDK pipeline manual approval (SNS email gate)
- No direct push

---

## CDK Stack Isolation per Environment

Each environment deploys 5 fully independent CDK stacks:

```
DEV (weather-app-dev-*)
  weather-app-dev-vpc        VPC 10.0.0.0/16, 1 AZ, public only
  weather-app-dev-security   EC2 SG + IAM role
  weather-app-dev-ecr        ECR repo, max 3 images
  weather-app-dev-ec2        t2.micro, Elastic IP
  weather-app-dev-pipeline   CodePipeline + CodeBuild (branch: dev)
  /weather-app/dev/*         SSM SecureString for OWM key

QA (weather-app-qa-*)        [designed, not yet deployed]
  Same 5 stacks, different VPC CIDR + branch + SSM namespace

STAGING (weather-app-staging-*)  [designed, not yet deployed]
  Same 5 stacks + NAT Gateway + manual approval gate

PROD (weather-app-prod-*)    [designed, not yet deployed]
  Same 5 stacks + 2 AZ + higher instance type + Secrets Manager
```

---

## Rollback Strategy

| Scenario | Action |
|---|---|
| Bad container deploy | SSH via SSM Session Manager → `docker pull <repo>:previous-tag && docker rm -f weather-app && docker run ...` |
| Bad pipeline run | CodePipeline → disable transition, push a revert commit to trigger clean redeploy |
| Infrastructure broken | `npx cdk deploy --all` from last known-good IaC commit |
| Nuclear option | `npx cdk destroy --all --force` + re-deploy from scratch (< 15 min) |

---

## Commit Message Convention

```
<type>(<scope>): <subject>

Types: feat | fix | infra | ci | docs | refactor | test | chore

Examples:
  feat(weather): add 10-day forecast card
  fix(api): handle missing OpenWeather API key gracefully
  infra(cdk): add QA environment config
  ci(pipeline): insert manual approval gate for staging
  docs(hld): update architecture for Week 2 EC2 deployment
```

---

## Hotfix Flow (future)

```
  PRODUCTION BUG DETECTED
         │
         ▼
  $ git checkout -b hotfix/fix-api-crash main
         │  Fix committed + reviewed
         ▼
  hotfix/* ──► staging (expedited approval) ──► main (production)
         │
         │  Back-merge (mandatory — all lower envs get the fix)
         ▼
  hotfix/* ──► staging ──► qa ──► dev
```

---

## Naming Conventions

```
Week-N                         weekly deliverable branch
  e.g.  Week-1, Week-2

feature/<ticket>-<description> future feature branches (off dev)
  e.g.  feature/WEA-42-add-wind-card

hotfix/<ticket>-<description>  emergency fixes (off main)
  e.g.  hotfix/WEA-99-fix-api-key-null
```
