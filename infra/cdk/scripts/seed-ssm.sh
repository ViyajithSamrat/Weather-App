#!/usr/bin/env bash
# =============================================================================
# seed-ssm.sh — write the OpenWeather API key into SSM Parameter Store.
#
# The key is a SECRET: it never lives in CDK code, git, or the Docker image.
# Run this ONCE per environment before the first pipeline deploy. The EC2
# instance reads it at container-start time (see docker-ec2-construct.ts).
#
# Usage:
#   ./scripts/seed-ssm.sh dev <OPENWEATHER_API_KEY>
#
# Example:
#   ./scripts/seed-ssm.sh dev c0a5f0fcbeddcfe0f5c597a3efd8e680
# =============================================================================
set -euo pipefail

ENV="${1:?Usage: seed-ssm.sh <env> <api-key>}"
KEY="${2:?Usage: seed-ssm.sh <env> <api-key>}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
PARAM="/weather-app/${ENV}/OPENWEATHER_API_KEY"

aws ssm put-parameter \
  --name "$PARAM" \
  --value "$KEY" \
  --type SecureString \
  --overwrite \
  --region "$REGION" \
  --description "OpenWeather API key for weather-app ${ENV}"

echo "Seeded SecureString: ${PARAM} (region ${REGION})"
