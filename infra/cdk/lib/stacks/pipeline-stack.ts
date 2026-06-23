import {
  Stack,
  StackProps,
  RemovalPolicy,
  Arn,
  CfnOutput,
} from "aws-cdk-lib";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as cpactions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";

export interface PipelineStackProps extends StackProps {
  config: EnvConfig;
  repository: ecr.IRepository;
  /** EC2 instance the build step deploys to via SSM Run Command. */
  instanceId: string;
}

/**
 * CI/CD: GitHub -> CodeBuild (build + push + deploy) on every push.
 *
 * Free-tier shape:
 *   - 1 pipeline (free tier covers exactly 1).
 *   - 1 CodeBuild project, SMALL compute (100 build-min/month free).
 *   - No ECS/CodeDeploy. Deployment = `aws ssm send-command` telling the
 *     EC2 box to run /opt/deploy.sh (pull :latest, restart container).
 *
 * Two stages: SOURCE (GitHub via CodeStar connection) and BUILD (which also
 * deploys). An APPROVAL stage is added for staging/prod later — dev auto-deploys.
 */
export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { config, repository, instanceId } = props;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;

    // ── Artifact bucket (auto-cleaned on destroy in dev) ───────────────────
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      bucketName: `weather-app-${config.envName}-artifacts-${account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── CodeBuild: build image, push to ECR, deploy to EC2 via SSM ─────────
    const buildProject = new codebuild.PipelineProject(this, "Build", {
      projectName: `weather-app-${config.envName}-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true, // required to run `docker build`
      },
      environmentVariables: {
        AWS_REGION: { value: region },
        REGISTRY: { value: registry },
        REPO_URI: { value: repository.repositoryUri },
        INSTANCE_ID: { value: instanceId },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              'echo "=== ECR login ==="',
              "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY",
              "IMAGE_TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION:0:7}",
            ],
          },
          build: {
            commands: [
              'echo "=== Docker build ==="',
              "docker build -t $REPO_URI:$IMAGE_TAG -t $REPO_URI:latest -f Dockerfile .",
            ],
          },
          post_build: {
            commands: [
              'echo "=== Push to ECR ==="',
              "docker push $REPO_URI:$IMAGE_TAG",
              "docker push $REPO_URI:latest",
              'echo "=== Deploy to EC2 via SSM ==="',
              "CMD_ID=$(aws ssm send-command --instance-ids $INSTANCE_ID --document-name AWS-RunShellScript --comment weather-app-deploy --parameters commands='bash /opt/deploy.sh' --region $AWS_REGION --query Command.CommandId --output text)",
              'echo "SSM command: $CMD_ID"',
              "aws ssm wait command-executed --command-id $CMD_ID --instance-id $INSTANCE_ID --region $AWS_REGION || true",
              "aws ssm get-command-invocation --command-id $CMD_ID --instance-id $INSTANCE_ID --region $AWS_REGION --query Status --output text",
            ],
          },
        },
      }),
    });

    // CodeBuild permissions (least privilege) ───────────────────────────────
    repository.grantPullPush(buildProject);

    const instanceArn = Arn.format(
      { service: "ec2", resource: "instance", resourceName: instanceId },
      this,
    );
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "DeployViaSsm",
        actions: ["ssm:SendCommand"],
        resources: [
          instanceArn,
          Arn.format(
            {
              service: "ssm",
              resource: "document",
              resourceName: "AWS-RunShellScript",
            },
            this,
          ),
        ],
      }),
    );
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadSsmCommandResult",
        actions: ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
        resources: ["*"],
      }),
    );

    // ── Pipeline: Source -> Build ──────────────────────────────────────────
    const sourceOutput = new codepipeline.Artifact("SourceOutput");

    const sourceAction = new cpactions.CodeStarConnectionsSourceAction({
      actionName: "GitHub_Source",
      owner: config.github.owner,
      repo: config.github.repo,
      branch: config.github.branch,
      connectionArn: config.github.connectionArn,
      output: sourceOutput,
      triggerOnPush: true,
    });

    const buildAction = new cpactions.CodeBuildAction({
      actionName: "Build_Push_Deploy",
      project: buildProject,
      input: sourceOutput,
    });

    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `weather-app-${config.envName}-pipeline`,
      artifactBucket,
      crossAccountKeys: false, // cheaper + simpler (single-account)
      restartExecutionOnUpdate: true,
      stages: [
        { stageName: "Source", actions: [sourceAction] },
        // For staging/prod: insert a ManualApprovalAction stage here.
        { stageName: "Build", actions: [buildAction] },
      ],
    });

    new CfnOutput(this, "PipelineName", {
      value: pipeline.pipelineName,
      description: "CodePipeline name",
    });
  }
}
