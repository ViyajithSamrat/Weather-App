# =============================================================================
# Enterprise Weather App — Developer Makefile
#
# Usage: make <target> [ENV=dev|qa|staging|prod]
#
# Prerequisites:
#   - Docker + Docker Compose
#   - AWS CLI v2 (configured with appropriate profile)
#   - bash 4+ (for deploy targets)
#
# Defaults: ENV=dev
# =============================================================================

ENV        ?= dev
APP_NAME   := weather-app
AWS_REGION ?= us-east-1
STACK_PREFIX := $(APP_NAME)-$(ENV)

.DEFAULT_GOAL := help

.PHONY: help \
        dev build up down logs shell \
        lint typecheck validate-docker \
        ecr-push \
        cf-ecr cf-ecs cf-pipeline cf-deploy-all cf-delete \
        ssm-params secrets-staging \
        status pipeline-status \
        trivy-scan

# =============================================================================
# Help
# =============================================================================
help: ## Show this help message
	@echo ""
	@echo "  Enterprise Weather App — Make Targets"
	@echo "  ───────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  ENV (default: dev)  →  make <target> ENV=qa"
	@echo ""

# =============================================================================
# Local Development
# =============================================================================
dev: ## Start Next.js dev server (hot-reload, no Docker)
	cd weather-app && npm run dev

build: ## Build Docker image locally (runner stage)
	docker build \
	  --target runner \
	  --tag $(APP_NAME):local \
	  --file Dockerfile \
	  .
	@echo "✓ Built $(APP_NAME):local"

up: ## Build + start the local Docker stack
	docker compose up --build

up-detach: ## Build + start the local Docker stack (detached)
	docker compose up --build -d

down: ## Stop and remove the local Docker stack
	docker compose down -v

logs: ## Tail local container logs
	docker compose logs -f weather-app

shell: ## Open a shell inside the running container
	docker compose exec weather-app sh

# =============================================================================
# Code Quality
# =============================================================================
install: ## Install npm dependencies
	cd weather-app && npm ci --frozen-lockfile

lint: ## Run ESLint
	cd weather-app && npm run lint

typecheck: ## Run TypeScript type check (no emit)
	cd weather-app && npx tsc --noEmit

validate-docker: ## Validate Dockerfile build (no push)
	docker buildx build \
	  --file Dockerfile \
	  --target runner \
	  --load \
	  --tag $(APP_NAME):validate \
	  . && \
	echo "✓ Dockerfile valid — image size: $$(docker image inspect $(APP_NAME):validate --format '{{.Size}}' | numfmt --to=iec)"

trivy-scan: ## Run Trivy vulnerability scan on local image
	@command -v trivy >/dev/null 2>&1 || { echo "Install trivy: https://github.com/aquasecurity/trivy"; exit 1; }
	trivy image --severity HIGH,CRITICAL $(APP_NAME):local

# =============================================================================
# CloudFormation — deploy individual stacks
# Usage: make cf-ecr ENV=staging
# =============================================================================
cf-ecr: ## Deploy ECR stack for ENV
	@echo "─── Deploying ECR stack: $(STACK_PREFIX)-ecr ───"
	bash infra/scripts/deploy.sh $(ENV) ecr

cf-ecs: ## Deploy ECS stack for ENV (depends on ecr)
	@echo "─── Deploying ECS stack: $(STACK_PREFIX)-ecs ───"
	bash infra/scripts/deploy.sh $(ENV) ecs

cf-pipeline: ## Deploy Pipeline stack for ENV (depends on ecs)
	@echo "─── Deploying Pipeline stack: $(STACK_PREFIX)-pipeline ───"
	bash infra/scripts/deploy.sh $(ENV) pipeline

cf-deploy-all: cf-ecr cf-ecs cf-pipeline ## Deploy ALL stacks for ENV in order
	@echo "✓ All stacks deployed for ENV=$(ENV)"

cf-delete: ## Delete ALL CloudFormation stacks for ENV (DESTRUCTIVE — asks confirmation)
	@read -p "Delete all $(ENV) stacks? [y/N]: " confirm && [ "$${confirm}" = "y" ] || exit 1
	aws cloudformation delete-stack --stack-name $(STACK_PREFIX)-pipeline --region $(AWS_REGION)
	aws cloudformation delete-stack --stack-name $(STACK_PREFIX)-ecs      --region $(AWS_REGION)
	@echo "⚠  ECR stack ($(STACK_PREFIX)-ecr) has DeletionPolicy:Retain — delete manually if needed"

# =============================================================================
# ECR Operations
# =============================================================================
ecr-push: build ## Tag and push local image to ECR for ENV
	$(eval ACCOUNT_ID := $(shell aws sts get-caller-identity --query Account --output text))
	$(eval ECR_URI := $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/$(APP_NAME)-$(ENV))
	aws ecr get-login-password --region $(AWS_REGION) | \
	  docker login --username AWS --password-stdin $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
	docker tag $(APP_NAME):local $(ECR_URI):manual-push
	docker push $(ECR_URI):manual-push
	@echo "✓ Pushed $(ECR_URI):manual-push"

# =============================================================================
# Secrets / SSM
# =============================================================================
ssm-params: ## Verify SSM parameters exist for ENV (does NOT print values)
	@echo "─── SSM parameters for /weather-app/$(ENV)/ ───"
	aws ssm get-parameters-by-path \
	  --path /weather-app/$(ENV)/ \
	  --with-decryption \
	  --query "Parameters[*].{Name:Name,Type:Type,LastModified:LastModifiedDate}" \
	  --output table \
	  --region $(AWS_REGION)

secrets-staging: ## Show Secrets Manager secret names for staging/prod (no values)
	aws secretsmanager list-secrets \
	  --filters Key=name,Values=weather-app/$(ENV) \
	  --query "SecretList[*].{Name:Name,LastChanged:LastChangedDate}" \
	  --output table \
	  --region $(AWS_REGION)

# =============================================================================
# Operational Status
# =============================================================================
status: ## Show ECS service status for ENV
	@echo "─── ECS Service Status: $(STACK_PREFIX) ───"
	aws ecs describe-services \
	  --cluster $(STACK_PREFIX)-cluster \
	  --services $(STACK_PREFIX)-service \
	  --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount,Pending:pendingCount,Health:healthCheckGracePeriodSeconds}" \
	  --output table \
	  --region $(AWS_REGION)

pipeline-status: ## Show CodePipeline execution status for ENV
	@echo "─── Pipeline Executions: $(STACK_PREFIX)-pipeline ───"
	aws codepipeline list-pipeline-executions \
	  --pipeline-name $(STACK_PREFIX)-pipeline \
	  --max-results 5 \
	  --query "pipelineExecutionSummaries[*].{Id:pipelineExecutionId,Status:status,Trigger:trigger.triggerType,Started:startTime}" \
	  --output table \
	  --region $(AWS_REGION)

alb-url: ## Print the ALB DNS URL for ENV
	@aws cloudformation describe-stacks \
	  --stack-name $(STACK_PREFIX)-ecs \
	  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
	  --output text \
	  --region $(AWS_REGION) | xargs -I{} echo "http://{}"
