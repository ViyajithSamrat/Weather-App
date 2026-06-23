#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { devConfig } from "../config/dev";
import { EnvConfig } from "../config/env-config";
import { VpcStack } from "../lib/stacks/vpc-stack";
import { SecurityStack } from "../lib/stacks/security-stack";
import { EcrStack } from "../lib/stacks/ecr-stack";
import { Ec2Stack } from "../lib/stacks/ec2-stack";
import { PipelineStack } from "../lib/stacks/pipeline-stack";

const app = new cdk.App();

/**
 * Build the full stack set for one environment.
 *
 * Adding QA/staging/prod later = create qa.ts/staging.ts/prod.ts and call
 * deployEnvironment(app, qaConfig). Nothing in this function changes.
 */
function deployEnvironment(scope: cdk.App, config: EnvConfig) {
  const env = { account: config.account, region: config.region };
  const prefix = `weather-app-${config.envName}`;

  // 1. Network
  const vpcStack = new VpcStack(scope, `${prefix}-vpc`, { env, config });

  // 2. Security groups + IAM roles
  const securityStack = new SecurityStack(scope, `${prefix}-security`, {
    env,
    config,
    vpc: vpcStack.vpc,
  });

  // 3. ECR repository
  const ecrStack = new EcrStack(scope, `${prefix}-ecr`, { env, config });

  // 4. EC2 compute (t2.micro running the container)
  const ec2Stack = new Ec2Stack(scope, `${prefix}-ec2`, {
    env,
    config,
    vpc: vpcStack.vpc,
    securityGroup: securityStack.instanceSecurityGroup,
    instanceRole: securityStack.instanceRole,
    repository: ecrStack.repository,
  });

  // 5. CI/CD pipeline
  new PipelineStack(scope, `${prefix}-pipeline`, {
    env,
    config,
    repository: ecrStack.repository,
    instanceId: ec2Stack.instanceId,
  });

  // Silence unused-var lint for the wired stacks (kept as named locals for clarity)
  void securityStack;
}

// DEV only for Week 2. Future: deployEnvironment(app, qaConfig); etc.
deployEnvironment(app, devConfig);

// Apply common tags to every resource across all stacks
for (const [k, v] of Object.entries(devConfig.tags)) {
  cdk.Tags.of(app).add(k, v);
}

app.synth();
