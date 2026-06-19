# Production Deployment SOP

**Version:** 1.0
**Date:** 2026-06-19
**Scope:** Weather App — promoting code from dev to prod

---

## Pre-Deployment Checklist

Run this checklist before opening a PR from `dev` → `main`.

### Code Readiness
- [ ] All changes are on the `dev` branch
- [ ] `npm run test:coverage` passes locally (no failures, 60%+ coverage)
- [ ] `npm run lint` passes locally
- [ ] App runs correctly on DEV environment (`http://dev-elastic-ip`)
- [ ] No `console.error` spam in dev CloudWatch logs
- [ ] No `set -x` in any shell scripts (deploy.sh, seed-ssm.sh)
- [ ] No secrets or API keys committed to git
- [ ] Dockerfile change? Verified on DEV first

### Infrastructure Readiness
- [ ] DEV EC2 instance is running and healthy
- [ ] PROD EC2 instance is running and healthy
- [ ] `aws ec2 describe-instances --filters "Name=tag:Name,Values=weather-app-prod"` shows running
- [ ] PROD SSM parameter exists: `/weather-app/prod/OPENWEATHER_API_KEY`
- [ ] PROD CodePipeline exists: `weather-app-prod-pipeline`

---

## Deployment Steps

### Step 1: Open the Pull Request

```bash
cd "c:\project\Weather App"
git checkout dev
git pull origin dev

gh pr create \
  --base main \
  --head dev \
  --title "release: <description of what's changing>" \
  --body "## Summary
- <bullet point of change 1>
- <bullet point of change 2>

## Test evidence
- Production Gate passed: [link to GitHub Actions run]
- Verified on DEV: http://dev-elastic-ip

## Rollback plan
- Previous ECR tag: <sha> (use Section 1 of ROLLBACK_SOP.md if needed)"
```

### Step 2: Wait for Production Gate

GitHub Actions `prod-gate.yml` will run automatically. All 4 jobs must be green:

| Job | Expected result |
|---|---|
| Unit Tests (Vitest) | green |
| E2E & Smoke Tests | green |
| SonarCloud Analysis | green or skipped (if no SONAR_TOKEN) |
| Production Gate (required) | **GREEN — this is the required check** |

If any blocking job fails: **do not merge**. Fix the failure and re-push to dev.

### Step 3: Review and Merge the PR

Review the diff:
- No hardcoded values that should be in config
- No secrets in code
- Docker build context is correct (Dockerfile unchanged or intentionally changed)

Merge using "Merge commit" (not squash — preserves feature branch history).

### Step 4: Monitor CodePipeline (prod)

```
AWS Console → CodePipeline → weather-app-prod-pipeline
```

Wait for the pipeline to reach the APPROVE stage (~1 min after merge).

### Step 5: Approve the Production Deploy

1. SNS email arrives at `samratviyajith@gmail.com`
2. Open the link in the email, OR: AWS Console → CodePipeline → `weather-app-prod-pipeline` → Review → Approve
3. Add a comment: `"PR #<number> verified on DEV, Production Gate passed, approved"`

### Step 6: Monitor the Build

```
AWS Console → CodePipeline → weather-app-prod-pipeline → BUILD stage → View logs
```

Expected CodeBuild output:
```
=== ECR login ===
Login Succeeded
=== Docker build (with layer cache from :latest) ===
[... docker build output ...]
=== Push to ECR ===
[1/1] Pushed abc1234
=== Deploy to EC2 via SSM ===
SSM command ID: a1b2c3d4-...
[1/30] Deploy status: InProgress
[2/30] Deploy status: InProgress
[3/30] Deploy status: Success
Status: Success
```

Total build time: ~2-4 minutes.

### Step 7: Verify Production

```bash
# HTTP check
curl -I http://PROD_ELASTIC_IP

# API check
curl "http://PROD_ELASTIC_IP/api/geocode?q=Lo"   # expect []
curl "http://PROD_ELASTIC_IP/api/geocode?q=London" # expect JSON

# Tile API check
curl "http://PROD_ELASTIC_IP/api/weather/bad_layer/1/1/1"  # expect 400

# Container logs
aws logs tail /weather-app/prod/app --follow --region ap-south-1

# Browser test: open http://PROD_ELASTIC_IP
# - Page loads
# - Search for a city
# - Weather data displays
# - Map renders (no blank tiles)
```

---

## Emergency Procedures

### If Production Gate fails after PR is open

Do NOT merge. Fix the failure:
```bash
git checkout dev
# Fix the failing test or code
git commit -m "fix: <what you fixed>"
git push origin dev
# Production Gate re-runs automatically on the updated PR
```

### If CodeBuild fails after approve

```bash
# Check the error in CodeBuild logs
# Fix the issue if code-related, push to dev, new PR to main

# If the issue is transient (ECR timeout, SSM blip):
aws codepipeline start-pipeline-execution \
  --name weather-app-prod-pipeline \
  --region ap-south-1
# Then re-approve via SNS/Console
```

### If the deploy succeeds but app is broken

See `docs/ROLLBACK_SOP.md` → Section 1 (Container Rollback, < 2 min).

---

## Post-Deployment Verification (30 min after deploy)

- [ ] CloudWatch logs: no error spike in `/weather-app/prod/app`
- [ ] No unexpected container restarts: `docker inspect weather-app | grep RestartCount`
- [ ] HTTP 200 on homepage
- [ ] Geocode API returns results for a real city
- [ ] Weather tile proxy returns tiles (or 500 if key not configured — expected)

---

## Deployment Anti-Patterns (NEVER DO THESE)

| Anti-pattern | Why it's dangerous |
|---|---|
| Push directly to `main` without a PR | Bypasses Production Gate and code review |
| Merge `main` into `dev` to "sync up" | Creates a merge loop; confuses pipeline history |
| Add `set -x` to deploy.sh | Logs the KMS-decrypted API key in SSM Run Command output |
| Commit `.env.local` or API keys | Exposes secrets in git history permanently |
| Use `--no-verify` on commits | Bypasses pre-commit hooks (if configured) |
| Approve SNS without reading the PR | Human review has no value if approver isn't informed |
| Deploy on Friday at 5pm | No one available to rollback over the weekend |
