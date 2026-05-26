#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — First-time AWS environment setup
#
# Run ONCE per environment before deploying any CloudFormation stacks.
# This script creates the prerequisites that CloudFormation cannot create itself:
#   1. SSM Parameter Store secrets (dev/qa)
#   2. Secrets Manager secrets (staging/prod)
#   3. Verifies CodeStar GitHub Connection exists
#   4. Pushes a placeholder image to ECR (needed for initial ECS service)
#
# Usage:
#   ./infra/scripts/bootstrap.sh <environment>
#
# Examples:
#   ./infra/scripts/bootstrap.sh dev
#   ./infra/scripts/bootstrap.sh staging
#
# Prerequisites:
#   - AWS CLI v2, Docker, jq, bash 4+
#   - AWS credentials configured (aws configure or IAM role)
#   - Real API keys in hand (OpenWeather + Mapbox)
# =============================================================================
set -euo pipefail

# ── Args ─────────────────────────────────────────────────────────────────────
ENV=${1:?Usage: bootstrap.sh <env>  (dev|qa|staging|prod)}
APP_NAME="weather-app"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# Validate environment
case "$ENV" in
  dev|qa|staging|prod) ;;
  *) echo "ERROR: env must be dev | qa | staging | prod"; exit 1 ;;
esac

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*"; exit 1; }
step() { echo -e "\n${YELLOW}══>${NC} $*"; }

# ── Detect account ───────────────────────────────────────────────────────────
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_REPO="${APP_NAME}-${ENV}"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Bootstrap: ${APP_NAME} — ENV=${ENV}"
echo "  Account  : ${AWS_ACCOUNT_ID}"
echo "  Region   : ${AWS_REGION}"
echo "═══════════════════════════════════════════════════════════════════════════"

# =============================================================================
# Step 1 — Secrets
# =============================================================================
step "Configuring secrets for ENV=${ENV}"

collect_secret() {
  local name="$1"
  local description="$2"
  local default="${3:-}"
  echo ""
  echo "  ${description}"
  if [[ -n "$default" ]]; then
    echo "  (Press Enter to use default: ${default})"
  fi
  read -r -s -p "  Enter value: " value
  echo ""
  if [[ -z "$value" && -n "$default" ]]; then
    value="$default"
  fi
  if [[ -z "$value" ]]; then
    err "Value for ${name} cannot be empty"
  fi
  echo "$value"
}

case "$ENV" in
  dev|qa)
    # SSM Parameter Store — free, sufficient for non-prod
    step "Writing secrets to AWS SSM Parameter Store (/weather-app/${ENV}/)"

    OWM_KEY=$(collect_secret "OPENWEATHER_API_KEY" \
      "OpenWeather API key (get free key at openweathermap.org/api)")
    aws ssm put-parameter \
      --name "/weather-app/${ENV}/OPENWEATHER_API_KEY" \
      --value "$OWM_KEY" \
      --type SecureString \
      --overwrite \
      --region "$AWS_REGION" \
      --tags "Key=Environment,Value=${ENV}" "Key=Application,Value=${APP_NAME}" \
      --description "OpenWeather API key for ${APP_NAME} ${ENV}" \
      > /dev/null
    ok "SSM: /weather-app/${ENV}/OPENWEATHER_API_KEY"

    MAPBOX_TOKEN=$(collect_secret "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN" \
      "Mapbox public token (get at account.mapbox.com/access-tokens — restrict by URL!)")
    aws ssm put-parameter \
      --name "/weather-app/${ENV}/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN" \
      --value "$MAPBOX_TOKEN" \
      --type String \
      --overwrite \
      --region "$AWS_REGION" \
      --tags "Key=Environment,Value=${ENV}" "Key=Application,Value=${APP_NAME}" \
      --description "Mapbox public token for ${APP_NAME} ${ENV}" \
      > /dev/null
    ok "SSM: /weather-app/${ENV}/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN"
    ;;

  staging|prod)
    # Secrets Manager — rotation support + audit trail for production
    step "Writing secrets to AWS Secrets Manager (weather-app/${ENV}/secrets)"

    SECRET_NAME="weather-app/${ENV}/secrets"

    OWM_KEY=$(collect_secret "OPENWEATHER_API_KEY" \
      "OpenWeather API key (prod key — keep it secure!)")
    MAPBOX_TOKEN=$(collect_secret "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN" \
      "Mapbox public token (prod token — restrict by URL in Mapbox dashboard!)")

    SECRET_JSON=$(jq -n \
      --arg owm "$OWM_KEY" \
      --arg mapbox "$MAPBOX_TOKEN" \
      '{"OPENWEATHER_API_KEY": $owm, "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN": $mapbox}')

    # Create or update
    if aws secretsmanager describe-secret \
        --secret-id "$SECRET_NAME" \
        --region "$AWS_REGION" > /dev/null 2>&1; then
      aws secretsmanager put-secret-value \
        --secret-id "$SECRET_NAME" \
        --secret-string "$SECRET_JSON" \
        --region "$AWS_REGION" > /dev/null
      ok "Secrets Manager updated: ${SECRET_NAME}"
    else
      aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "${APP_NAME} ${ENV} API keys" \
        --secret-string "$SECRET_JSON" \
        --region "$AWS_REGION" \
        --tags \
          "Key=Environment,Value=${ENV}" \
          "Key=Application,Value=${APP_NAME}" \
        > /dev/null
      ok "Secrets Manager created: ${SECRET_NAME}"
    fi
    ;;
esac

# =============================================================================
# Step 2 — Push placeholder image to ECR
# (ECS service needs at least one image to reach ACTIVE state)
# =============================================================================
step "Pushing placeholder image to ECR (${ECR_REPO})"

# Verify ECR repo exists (should have been created by ecr.yml stack)
if ! aws ecr describe-repositories \
    --repository-names "$ECR_REPO" \
    --region "$AWS_REGION" > /dev/null 2>&1; then
  err "ECR repository '${ECR_REPO}' not found. Deploy ecr.yml stack first:\n  make cf-ecr ENV=${ENV}"
fi

# ECR login
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

PLACEHOLDER_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:placeholder"

# Pull a tiny public image and re-tag it as the placeholder
# Using node:20-alpine since our runner already uses it — no extra pull on ECS
docker pull node:20-alpine --quiet
docker tag node:20-alpine "$PLACEHOLDER_IMAGE"
docker push "$PLACEHOLDER_IMAGE"
ok "Placeholder image pushed: ${PLACEHOLDER_IMAGE}"

# =============================================================================
# Step 3 — Verify CodeStar Connection
# =============================================================================
step "Checking CodeStar GitHub Connection"

CONNECTIONS=$(aws codestar-connections list-connections \
  --provider-type GitHub \
  --region "$AWS_REGION" \
  --query "Connections[?ConnectionStatus=='AVAILABLE']" \
  --output json 2>/dev/null || echo "[]")

COUNT=$(echo "$CONNECTIONS" | jq length)

if [[ "$COUNT" -eq 0 ]]; then
  warn "No active GitHub CodeStar Connection found."
  echo ""
  echo "  Create one manually:"
  echo "    1. AWS Console → Developer Tools → Settings → Connections"
  echo "    2. Create connection → GitHub"
  echo "    3. Authorize the GitHub App"
  echo "    4. Copy the ARN and set it in:"
  echo "       infra/cloudformation/parameters/${ENV}.json"
  echo "       → CodeStarConnectionArn"
  echo ""
else
  echo "$CONNECTIONS" | jq -r '.[] | "  \(.ConnectionName)  \(.ConnectionArn)"'
  ok "${COUNT} active GitHub connection(s) found"
  warn "Verify the correct ARN is set in infra/cloudformation/parameters/${ENV}.json"
fi

# =============================================================================
# Step 4 — Summary
# =============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Bootstrap complete for ENV=${ENV}"
echo ""
echo "  Next steps:"
echo "    1. Verify CodeStarConnectionArn in:"
echo "       infra/cloudformation/parameters/${ENV}.json"
if [[ "$ENV" == "staging" || "$ENV" == "prod" ]]; then
echo "    2. Set NotificationEmail in the same file"
echo "    3. Deploy stacks in order:"
fi
echo ""
echo "    make cf-ecr      ENV=${ENV}   # already deployed (ECR must exist for placeholder push)"
echo "    make cf-ecs      ENV=${ENV}   # VPC, ALB, ECS Fargate"
echo "    make cf-pipeline ENV=${ENV}   # CodePipeline, CodeBuild"
echo ""
echo "  Or run all at once:"
echo "    make cf-deploy-all ENV=${ENV}"
echo "═══════════════════════════════════════════════════════════════════════════"
