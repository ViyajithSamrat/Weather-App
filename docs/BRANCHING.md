# Branching Strategy & Git Flow

**Version:** 1.0  
**Date:** 2026-05-21

---

## Core Principle

Every Git branch maps 1:1 to an AWS environment. A push to a branch is the **only** deployment trigger — there are no manual console deploys.

---

## Branch → Environment Map

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

---

## Promotion Flow Diagram

```
  DEVELOPER                GIT BRANCHES                   AWS ENVIRONMENTS
  ─────────                ────────────                   ────────────────

  $ git checkout           feature/add-wind-card
    -b feature/...               │
                                 │  PR review
                                 │  + approval
                                 ▼
                            dev branch  ──────────────►  DEV  (auto-deploy)
                                 │                        │
                                 │  PR + integration      │  QA team validates
                                 │  tests pass            │
                                 ▼                        ▼
                             qa branch  ──────────────►  QA   (auto-deploy)
                                 │                        │
                                 │  PR + QA sign-off      │  Performance/
                                 │                        │  regression tests
                                 ▼                        ▼
                          staging branch  ─────────►  STAGING (manual approval)
                                 │                        │
                                 │  PR + stakeholder      │  Final UAT
                                 │  approval              │
                                 ▼                        ▼
                            main branch  ─────────►  PRODUCTION (manual approval)
```

---

## Hotfix Flow

```
  PRODUCTION BUG DETECTED
         │
         ▼
  $ git checkout -b hotfix/fix-api-crash
         │
         │  Fix committed + reviewed
         │
         ▼
  hotfix/* ──────────────────────────────────────────►  STAGING
                                                          │
                                              Expedited   │
                                              approval    │
                                                          ▼
                                                      PRODUCTION
         │
         │  Back-merge (mandatory)
         ▼
  hotfix/* ──► main ──► staging ──► qa ──► dev
  (ensure all lower environments get the fix)
```

---

## Branch Protection Rules

### `main`
- Require PR with ≥ 2 reviewers
- Require all CI checks to pass
- Require CodePipeline manual approval
- No direct push — not even admins
- Linear history enforced

### `staging`
- Require PR with ≥ 1 reviewer
- Require CI checks to pass
- Require CodePipeline manual approval
- No direct push

### `qa`
- Require PR from `dev` or `feature/*` only
- Require CI checks to pass
- No direct push

### `dev`
- Require PR from `feature/*` or `hotfix/*`
- Require CI lint check to pass
- Direct push allowed for hotfixes (emergency only)

### `feature/*`
- No restrictions — developer's working branch
- Short-lived: delete after merge

---

## Naming Conventions

```
feature/<ticket-id>-<short-description>
  e.g.  feature/WEA-42-add-wind-card

hotfix/<ticket-id>-<short-description>
  e.g.  hotfix/WEA-99-fix-api-key-null

release/<version>  (optional, for tagged releases)
  e.g.  release/1.2.0
```

---

## Pipeline Trigger Matrix

```
┌──────────────────┬────────────────────────────┬──────────┬───────────────┐
│ Event            │ Pipeline Triggered          │ Env      │ Requires Gate │
├──────────────────┼────────────────────────────┼──────────┼───────────────┤
│ Push → dev       │ weather-app-dev-pipeline    │ DEV      │ No            │
│ Push → qa        │ weather-app-qa-pipeline     │ QA       │ No            │
│ Push → staging   │ weather-app-staging-pipeline│ STAGING  │ Yes           │
│ Push → main      │ weather-app-prod-pipeline   │ PROD     │ Yes           │
│ Push → feature/* │ None (local only)           │ -        │ -             │
│ Push → hotfix/*  │ None (local only)           │ -        │ -             │
└──────────────────┴────────────────────────────┴──────────┴───────────────┘
```

---

## Rollback Strategy

```
SCENARIO                        ACTION
────────────────────────────── ──────────────────────────────────────────────
Bad deploy detected (ECS)      ECS → Update Service → previous task definition
                                (zero-downtime rolling rollback)

Bad deploy detected (pipeline)  CodePipeline → Release Change on previous rev
                                OR git revert + push to trigger new pipeline

Critical production bug         hotfix/* branch → expedited approval path

Infrastructure broken           CloudFormation stack rollback:
                                aws cloudformation rollback-stack --stack-name ...
```

---

## Commit Message Convention

```
<type>(<scope>): <subject>

Types: feat | fix | infra | ci | docs | refactor | test | chore

Examples:
  feat(weather): add 10-day forecast card
  fix(api): handle missing OpenWeather API key gracefully
  infra(ecs): increase staging desired count to 2
  ci(pipeline): add manual approval gate to staging pipeline
  docs(hld): update cost model for ECS Fargate
```

---

## Environment Isolation Guarantee

Each environment has completely separate AWS resources. A failure in DEV
cannot affect PRODUCTION because they share nothing:

```
weather-app-dev-ecr      (ECR repo)
weather-app-dev-ecs      (VPC, ALB, ECS Cluster, Task, Service)
weather-app-dev-pipeline (CodePipeline, CodeBuild)
/weather-app/dev/*       (SSM parameters)

weather-app-qa-ecr
weather-app-qa-ecs
weather-app-qa-pipeline
/weather-app/qa/*

weather-app-staging-ecr
weather-app-staging-ecs
weather-app-staging-pipeline
/weather-app/staging/*   + Secrets Manager: weather-app/staging/secrets

weather-app-prod-ecr
weather-app-prod-ecs
weather-app-prod-pipeline
/weather-app/prod/*      + Secrets Manager: weather-app/prod/secrets
```
