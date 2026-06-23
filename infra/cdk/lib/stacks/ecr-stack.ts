import { Stack, StackProps, RemovalPolicy, Duration } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";

export interface EcrStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * ECR repository for the app's Docker images.
 *
 * Free-tier choices:
 *   - imageScanOnPush: catch CVEs for free.
 *   - lifecycle rule: keep only the last N images so we never exceed the 500 MB
 *     free allowance.
 *   - emptyOnDelete + DESTROY: `cdk destroy` leaves nothing behind in dev.
 */
export class EcrStack extends Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.repository = new ecr.Repository(this, "Repository", {
      repositoryName: `weather-app-${config.envName}`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE, // dev: allow :latest reuse
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        {
          description: "Expire untagged images after 1 day",
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(1),
          rulePriority: 1,
        },
        {
          // tagStatus defaults to ANY — must hold the highest priority number
          description: `Keep only the last ${config.ecrLifecycleCount} images`,
          maxImageCount: config.ecrLifecycleCount,
          rulePriority: 2,
        },
      ],
    });
  }
}
