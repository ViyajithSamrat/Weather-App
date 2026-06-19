# Branching Strategy & Git Flow

**Version:** 4.0
**Date:** 2026-06-19
**Model:** GitHub Flow (2-environment: dev + prod)

---

## Core Model

Two parallel strategies run in this polyrepo:

| Repo | Model | Why |
|---|---|---|
| Weather-App (app code) | 2 permanent branches (dev + main) | Pipelines watch each 24/7 |
| Weather-App-IAC (infra) | Week-based feature branches | Infra changes are infrequent, need review |

---

## Weather-App Branch Strategy

```
feature/* ─────────────────────────────────────────────────────────────────
    │  local development, docker compose up --build
    │  unit tests pass locally: npm run test:coverage
    ▼
dev branch ─────────────────────────────────────────────────► DEV env
    │  CodePipeline auto-deploys on every push
    │  Verify: http://dev-elastic-ip (IP-restricted to developer IP)
    │
    │  When ready to release:
    │  git checkout dev && git push origin dev (ensure latest is on dev)
    │  gh pr create --base main --head dev --title "release: ..."
    │
    │  GitHub Actions: prod-gate.yml triggers
    │  ├── Vitest unit tests + 60% coverage  [BLOCKING]
    │  ├── Playwright E2E tests               [BLOCKING]
    │  ├── pytest smoke tests                 [BLOCKING]
    │  └── SonarCloud analysis               [informational]
    │
    │  Production Gate (required) must be GREEN
    │  Human reviews diff → approves PR → merges
    ▼
main branch ────────────────────────────────────────────────► PROD env
    │  CodePipeline triggers automatically
    │  SNS email sent to samratviyajith@gmail.com
    │  Human clicks "Approve" in AWS Console
    │  CodeBuild: docker build → ECR push → SSM deploy
    ▼
http://prod-elastic-ip  (public, port 80)
```

---

## Branch Reference Table

| Branch | Pipeline watches | Deploy | Gate | Inbound access | Delete? |
|---|---|---|---|---|---|
| `main` | PROD pipeline | Manual SNS approval | Production Gate + human PR review | 0.0.0.0/0 (public) | Never |
| `dev` | DEV pipeline | Auto on every push | None (fast iteration) | Your IP /32 | Never |
| `feature/*` | None | None | None | N/A | After merge to dev |

---

## Developer Workflow

### Starting a Feature

```powershell
# 1. Always start from dev (not main)
git checkout dev
git pull origin dev

# 2. Create feature branch
git checkout -b feature/week3-cloudwatch-alarms

# 3. Write code, test locally
cd "c:\project\Weather App\weather-app"
npm run test:coverage     # must pass before pushing
docker compose up --build # verify app runs in container

# 4. Commit and push feature branch
git add .
git commit -m "feat(monitoring): add CloudWatch CPU alarm"
git push origin feature/week3-cloudwatch-alarms
```

### Promoting to DEV

```powershell
# Merge feature into dev (deploy to dev environment)
git checkout dev
git merge --no-ff feature/week3-cloudwatch-alarms
git push origin dev
# → CodePipeline auto-triggers on dev push
# → Verify at http://dev-elastic-ip in ~4 minutes
git branch -d feature/week3-cloudwatch-alarms
git push origin --delete feature/week3-cloudwatch-alarms
```

### Promoting to PROD (Release)

```powershell
# Create PR: dev → main (this triggers the Production Gate)
gh pr create \
  --base main \
  --head dev \
  --title "release: Week 3 — CloudWatch alarms + prod gate" \
  --body "$(cat docs/RELEASE_CHECKLIST.md)"

# Wait for Production Gate (required) to pass in GitHub Actions
# All 4 jobs must be green: unit-tests, e2e-and-smoke, sonarcloud, production-gate

# After gate passes: review the PR diff → merge to main
# CodePipeline triggers → SNS email → click Approve in AWS Console
# Production deploy completes in ~4-6 minutes
```

---

## Commit Message Convention

```
<type>(<scope>): <subject>

Types:
  feat     — new feature for the user
  fix      — bug fix
  infra    — CDK / infrastructure change
  ci       — GitHub Actions / pipeline change
  test     — adding or refactoring tests
  docs     — documentation only
  refactor — code restructuring without behavior change
  chore    — dependency bumps, cleanup

Examples:
  feat(weather): add 10-day forecast card
  fix(api): handle missing OpenWeather API key gracefully
  infra(cdk): add CloudWatch CPU alarm to ec2-stack
  ci(gate): add SonarCloud coverage quality gate
  test(units): add precipitation conversion tests
  docs(hld): update architecture to 2-environment model
```

---

## Environment Branch Rules (Enforced by GitHub Branch Protection)

### `main` branch
- **Required status check:** `Production Gate (required)` from `prod-gate.yml`
- PRs from `dev` only (no direct push, no feature/* to main)
- All status checks must pass before merge is allowed
- Configuration: GitHub → Settings → Branches → main

### `dev` branch
- No protection rules — fast iteration, direct push allowed
- CodePipeline watches: every push auto-deploys to DEV

---

## Infrastructure (Weather-App-IAC) Branch Strategy

```
main
  └── Week-X branches (active work)
        ├── Week-2 (CDK 5-stack IaC) ← current, pending merge
        └── Week-3 (monitoring, HTTPS) ← planned
```

### IAC Developer Workflow

```powershell
cd "c:\project\Weather-App-IAC"

git checkout main && git pull origin main
git checkout -b Week-3-monitoring

# Write CDK code
npx tsc --noEmit                                          # type check
npx cdk synth --context deploy-env=dev                   # validate CFN
npx cdk diff --context deploy-env=dev                    # review changes

# Deploy to dev first, test, then to prod
npx cdk deploy --all --context deploy-env=dev --require-approval never
# Verify dev env works

npx cdk deploy --all --context deploy-env=prod --require-approval never
# Review SNS email → Approve in CodePipeline

git checkout main && git merge --no-ff Week-3-monitoring
git push origin main
git branch -d Week-3-monitoring
git push origin --delete Week-3-monitoring
```

---

## Rollback via Git

### Revert a bad deploy (app code)

```powershell
# Option 1: Revert the merge commit (creates a new commit, safe)
git revert -m 1 <merge-commit-sha>
git push origin dev       # auto-redeploys to dev
# Or push to main after Production Gate passes for prod rollback

# Option 2: Use ECR image directly (fastest, no git change)
# See docs/ROLLBACK_SOP.md
```

### Hotfix flow (production emergency)

```powershell
# 1. Fix directly on dev branch (do NOT branch off main for hotfixes)
git checkout dev
# Make minimal fix
git commit -m "fix(security): patch XSS in weather card"
git push origin dev
# Verify fix in DEV env

# 2. Promote to prod immediately via PR
gh pr create --base main --head dev --title "hotfix: XSS patch"
# Production Gate must pass → merge → SNS approval → prod deploy
```

---

## Current Branch State (2026-06-19)

### Weather-App

| Branch | Status | Notes |
|---|---|---|
| `main` | Protected | Requires Production Gate |
| `dev` | Active, deployed | DEV CodePipeline watches this |
| `qa` | Deprecated | Removed from strategy (mentor direction) |
| `staging` | Deprecated | Removed from strategy |

### Weather-App-IAC

| Branch | Status | Notes |
|---|---|---|
| `main` | Baseline | Deployed CDK stacks |
| `Week-2` | Active | 5-stack CDK, dev+prod configs |

---

## Future Environment Expansion

If the project needs to add environments later (e.g., for a larger team):

```typescript
// config/staging.ts and config/qa.ts already exist as reference files
// To re-enable: in bin/weather-app.ts, add to configMap:
const configMap = {
  dev:     devConfig,
  prod:    prodConfig,
  // staging: stagingConfig,  // uncomment to re-enable
};
```

And add corresponding branches + GitHub Actions triggers.
