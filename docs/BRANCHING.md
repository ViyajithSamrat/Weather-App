# Branching Strategy & Git Flow

**Version:** 3.0
**Date:** 2026-06-04

---

## Core Model

Two parallel models run side-by-side in this polyrepo:

| Repo | Model | Why |
|---|---|---|
| Weather-App (app code) | Permanent environment branches | Pipeline watches each branch 24/7 |
| Weather-App-IAC (infra) | Week-based isolation branches | Infra changes are infrequent, need review |

---

## Weather-App Branch Model

```
main        ← Clean, tested code only. Pipeline watches this for PROD.
  │
  ├── Week-X    ← Feature work. Temporary. Deleted after merge to main.
  │
  ├── dev       ← PERMANENT. Pipeline auto-deploys to DEV on every push.
  ├── qa        ← PERMANENT. Pipeline auto-deploys to QA on every push.
  ├── staging   ← PERMANENT. Pipeline deploys with manual approval.
  └── (main)    ← PERMANENT. Pipeline deploys PROD with manual approval.
```

### Developer Workflow

```
1. git checkout main && git pull origin main
2. git checkout -b Week-3-my-feature
3. Write code, test locally: docker compose up --build
4. git add . && git commit -m "feat(weather): my feature"
5. git push origin Week-3-my-feature
6. git checkout main && git merge Week-3-my-feature
7. git push origin main
8. git branch -d Week-3-my-feature          (delete locally)
9. git push origin --delete Week-3-my-feature (delete remotely)

→ To deploy: git checkout dev && git merge main && git push origin dev
→ Pipeline triggers automatically, app live in ~5 minutes
```

### Environment Branch Rules

| Branch | Who pushes | Deploy trigger | Gate | Delete? |
|---|---|---|---|---|
| `main` | Anyone (after review) | PROD pipeline | SNS manual approval | Never |
| `staging` | `git merge main` | STAGING pipeline | SNS manual approval | Never |
| `qa` | `git merge dev` | QA pipeline | Auto | Never |
| `dev` | `git merge main` | DEV pipeline | Auto | Never |
| `Week-X` | Developer | None | None | After merge to main |

### Why Not Push Directly to dev/qa/staging/main?

Direct pushes cause messy history. The correct flow:
```
Work happens on Week-X → merge to main (clean) → cherry-pick to dev/qa for deploy
```

This keeps `main` as a clean snapshot of every release, and `dev`/`qa`/`staging` as deployment triggers that always mirror `main`.

---

## Weather-App-IAC Branch Model

```
main        ← Clean, deployed infrastructure baseline
  │
  ├── Week-2   ← Current CDK work. Merged to main when deployed and tested.
  └── Week-3   ← Planned. Monitoring, HTTPS, QA deploy.
```

### Infrastructure Deploy Workflow

```
1. git checkout main && git pull origin main
2. git checkout -b Week-3-monitoring
3. Write CDK code
4. npx tsc --noEmit         ← compile check
5. npx cdk synth            ← validate CloudFormation output
6. npx cdk diff             ← review what will change in AWS
7. npx cdk deploy --all     ← deploy to dev
8. Test the infra changes
9. git checkout main && git merge Week-3-monitoring
10. git push origin main
11. git branch -d Week-3-monitoring
```

---

## Current Branch State (2026-06-04)

### Weather-App

| Branch | Base | Status | Contains |
|---|---|---|---|
| `main` | — | Clean baseline | Week-1 merged (app + Docker) |
| `Week-1` | main | Merged → delete | Docker + Next.js app |
| `dev` | main | Active | CI/CD trigger for DEV env |

**Next steps:** Create `qa`, `staging` branches when those environments are deployed (Week 3).

### Weather-App-IAC

| Branch | Base | Status | Contains |
|---|---|---|---|
| `main` | — | Baseline | README, .gitignore |
| `Week-2` | main | Active, pending merge | 5 CDK stacks, 4 env configs, all fixes |

**Merge when ready:**
```powershell
cd "c:\project\Weather-App-IAC"
git checkout main
git merge --no-ff Week-2 -m "merge: Week-2 — CDK IaC, 4 environments, ap-south-1"
git push origin main
git branch -d Week-2
git push origin --delete Week-2
```

---

## Future Environment Branch Map (Week 3–4)

```
BRANCH       ENVIRONMENT   AUTO-DEPLOY   APPROVAL GATE
──────────   ───────────   ───────────   ─────────────
feature/*    (local only)  No            No
dev          DEV           Yes           No
qa           QA            Yes           No
staging      STAGING       No            Yes (SNS email)
main         PROD          No            Yes (SNS email)
hotfix/*     (local only)  No            No
```

---

## Commit Message Convention

```
<type>(<scope>): <subject>

Types: feat | fix | infra | ci | docs | refactor | test | chore

Examples:
  feat(weather): add 10-day forecast card
  fix(api): handle missing OpenWeather API key gracefully
  infra(cdk): add QA environment config
  ci(pipeline): add manual approval gate for staging
  docs(hld): update architecture for Week 3 monitoring
  fix(docker): use ECR public mirror to avoid Docker Hub rate limits
```

---

## Rollback Strategy

| Scenario | Action |
|---|---|
| Bad container deploy | SSM Session Manager → `docker pull <repo>:<prev-tag> && bash /opt/deploy.sh` |
| Bad pipeline run | CodePipeline console → disable transition; push revert commit |
| Infrastructure broken | `npx cdk deploy --all --context deploy-env=<env>` from last good IaC commit |
| Nuclear option | `npx cdk destroy --all --force && npx cdk deploy --all --context deploy-env=<env>` (< 20 min) |

---

## Branch Protection (Apply When Team Expands)

### `main` (both repos)
- Require PR with ≥ 1 reviewer
- All CI checks must pass
- No direct push

### `staging` / `main` in Weather-App
- Require PR + QA sign-off
- CI + Trivy scan required
- SNS approval gate in pipeline (already implemented)

### `Week-X` branches
- No restrictions during active development
- Delete after successful merge to `main`
