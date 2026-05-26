#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Manual / emergency CloudFormation stack deploy script
#
# Usage:
#   ./infra/scripts/deploy.sh <environment> <stack-type>
#
# Examples:
#   ./infra/scripts/deploy.sh dev ecr
#   ./infra/scripts/deploy.sh qa ecs
#   ./infra/scripts/deploy.sh staging pipeline
#   ./infra/scripts/deploy.sh prod pipeline
#
# Requirements: AWS CLI v2, jq, bash 4+
# =============================================================================
set -euo pipefail

ENV=${1:?Usage: deploy.sh <env> <stack-type>}
STACK_TYPE=${2:?Usage: deploy.sh <env> <stack-type>}
APP_NAME="weather-app"
AWS_REGION=${AWS_DEFAULT_REGION:-us-east-1}
STACK_NAME="${APP_NAME}-${ENV}-${STACK_TYPE}"
TEMPLATE="infra/cloudformation/stacks/${STACK_TYPE}.yml"
PARAMS="infra/cloudformation/parameters/${ENV}.json"

echo "===> Deploying stack: $STACK_NAME"
echo "     Template : $TEMPLATE"
echo "     Params   : $PARAMS"
echo "     Region   : $AWS_REGION"
echo ""

aws cloudformation deploy \
  --template-file "$TEMPLATE" \
  --stack-name "$STACK_NAME" \
  --parameter-overrides "file://$PARAMS" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset

echo ""
echo "===> Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs" \
  --output table
