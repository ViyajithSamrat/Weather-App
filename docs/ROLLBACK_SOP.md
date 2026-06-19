# Rollback Standard Operating Procedure (SOP)

**Version:** 1.0
**Date:** 2026-06-19
**Scope:** Weather App — dev and prod environments on AWS ap-south-1

---

## Quick Reference

| Scenario | Fastest fix | Time to restore |
|---|---|---|
| Container crash (new deploy) | Pull previous ECR image via SSM | < 2 min |
| Bad pipeline run (build failed) | Fix code, push, re-deploy | < 10 min |
| Bad pipeline run (deploy failed) | Re-run pipeline with previous commit | < 5 min |
| Infrastructure broken | `cdk deploy` from last known good commit | < 15 min |
| Nuclear (everything broken) | `cdk destroy && cdk deploy` | < 30 min |

---

## Section 1: Container Rollback (Fastest — No git needed)

Use when: new container is crashing, app is returning 500s, or deploy just caused a regression.

ECR keeps the last N tagged images per environment:
- dev: last 3 images
- prod: last 10 images

### Step 1: Find the previous image SHA

```bash
# List recent images (newest first)
aws ecr describe-images \
  --repository-name weather-app-prod \
  --query 'sort_by(imageDetails, &imagePushedAt) | reverse(@) | [*].{Tag:imageTags[0],SHA:imageDigest,Pushed:imagePushedAt}' \
  --output table \
  --region ap-south-1
```

Note the previous image tag (e.g., `abc1234`).

### Step 2: Connect to EC2 via SSM Session Manager

```
AWS Console → EC2 → Instances → weather-app-prod → Connect → Session Manager → Connect
```

Or via CLI:
```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region ap-south-1
```

### Step 3: Pull and run the previous image

```bash
# On the EC2 instance (SSM session):
ECR_URI="911167912708.dkr.ecr.ap-south-1.amazonaws.com/weather-app-prod"
PREV_TAG="abc1234"  # replace with the tag from Step 1

# Login to ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin 911167912708.dkr.ecr.ap-south-1.amazonaws.com

# Pull the previous image
docker pull $ECR_URI:$PREV_TAG

# Read the API key from SSM
KEY=$(aws ssm get-parameter \
  --name /weather-app/prod/OPENWEATHER_API_KEY \
  --with-decryption \
  --region ap-south-1 \
  --query Parameter.Value \
  --output text)

# Stop current container
docker rm -f weather-app 2>/dev/null || true

# Start previous image
docker run -d \
  --name weather-app \
  --restart unless-stopped \
  --log-driver awslogs \
  --log-opt awslogs-region=ap-south-1 \
  --log-opt awslogs-group=/weather-app/prod/app \
  --log-opt awslogs-stream=weather-app \
  --log-opt awslogs-create-group=true \
  -p 80:3000 \
  -e OPENWEATHER_API_KEY="$KEY" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e NEXT_TELEMETRY_DISABLED=1 \
  $ECR_URI:$PREV_TAG
```

### Step 4: Verify rollback succeeded

```bash
# On EC2 (SSM session):
docker ps
curl -I http://localhost:80

# From your machine:
curl -I http://PROD_ELASTIC_IP
```

---

## Section 2: Git Revert Rollback (Safe, Auditable)

Use when: the production deploy succeeded but a regression was found after the fact.

This creates a new commit that undoes the bad change — the safest approach for maintaining clean git history.

```bash
# Find the bad merge commit SHA
git log --oneline -10

# Create a revert commit (this is NOT destructive — adds a new commit)
git checkout dev
git revert -m 1 <bad-merge-commit-sha>
# -m 1 means "keep the first parent" (the dev branch before merge)

git push origin dev
# DEV auto-deploys with reverted code

# Verify on DEV
# Then promote to prod (Production Gate → PR → SNS approval)
gh pr create --base main --head dev --title "revert: <description>"
```

---

## Section 3: Pipeline Re-run with Previous Commit

Use when: CodeBuild failed mid-deploy (rare), or SSM command timed out.

```bash
# Find the last successful build's commit SHA
git log --oneline main

# Option A: Trigger CodePipeline manually with current main
aws codepipeline start-pipeline-execution \
  --name weather-app-prod-pipeline \
  --region ap-south-1

# Option B: If main has a bad commit — first revert (Section 2)
# then push → pipeline auto-triggers
```

---

## Section 4: Infrastructure Rollback (CDK)

Use when: a `cdk deploy` broke something at the infrastructure level (security group, IAM, VPC).

```bash
cd "C:\project\Weather-App-IAC"

# View current git state
git log --oneline -10

# Deploy from the last known good CDK commit
git checkout <good-commit-sha> -- .
npx cdk deploy --all --context deploy-env=prod --require-approval never

# Alternatively, just redeploy current CDK (fixes configuration drift)
git checkout main
npx cdk deploy --all --context deploy-env=prod --require-approval never
```

---

## Section 5: Nuclear Rollback (Last Resort)

Use when: environment is completely broken and above options failed.

**Warning:** This destroys and recreates the EC2 instance. Elastic IP is released and re-allocated — the app URL (IP) will change.

```bash
cd "C:\project\Weather-App-IAC"

# Destroy the broken environment
npx cdk destroy --all --context deploy-env=prod --force

# Wait for complete teardown (~5 min), then redeploy
npx cdk deploy --all --context deploy-env=prod --require-approval never

# Re-seed the API key (destroyed with the SSM param)
./scripts/seed-ssm.sh prod YOUR_OPENWEATHER_API_KEY

# Trigger initial pipeline deploy
aws codepipeline start-pipeline-execution \
  --name weather-app-prod-pipeline \
  --region ap-south-1
```

Total time: ~25-30 minutes. Use only if all other options fail.

---

## Section 6: Rollback Decision Tree

```
Production issue detected
        │
        ▼
Is the container running? (docker ps | grep weather-app)
        │
    YES │                       NO
        │                       │
        ▼                       ▼
Is the new deploy causing it?  Restart container from last ECR image
        │                       → Section 1
    YES │       NO
        │       │
        ▼       ▼
Did the    Is this a known
PR just    regression from
merge?     the last PR?
        │       │
    YES │   YES │
        │       │
        ▼       ▼
Section 1    Section 2
(immediate)  (git revert)

Did CDK change cause it?
        │
    YES │
        ▼
Section 4 (CDK rollback)

Is everything broken?
        │
    YES │
        ▼
Section 5 (nuclear — 30 min)
```

---

## Section 7: Post-Rollback Verification

After any rollback, verify the following:

```bash
# 1. Container is running
docker ps | grep weather-app

# 2. HTTP responds
curl -I http://PROD_ELASTIC_IP  # expect 200

# 3. API routes work
curl "http://PROD_ELASTIC_IP/api/geocode?q=Lo"  # expect []
curl "http://PROD_ELASTIC_IP/api/weather/bad_layer/1/1/1"  # expect 400

# 4. Container logs are flowing
aws logs tail /weather-app/prod/app --region ap-south-1

# 5. No restart loops
docker inspect weather-app | grep RestartCount  # should be 0 or low
```

---

## Section 8: Prevention

Rollbacks are symptoms of inadequate testing. The Production Gate catches regressions before they reach production:

- Run `npm run test:coverage` locally before pushing to dev
- Never push directly to `main` (bypass the Production Gate)
- Verify on DEV before opening a PR to main
- Read the PR diff carefully before approving
- Approve the SNS notification only after reading the PR
- Deploy during low-traffic hours (avoid Friday evening)
- Have a rollback plan written before approving any high-risk change
