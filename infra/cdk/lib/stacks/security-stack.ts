import { Stack, StackProps, Arn } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";

export interface SecurityStackProps extends StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
}

/**
 * Security groups + IAM roles, all least-privilege.
 *
 * Owns:
 *   - instanceSecurityGroup : inbound HTTP only; SSH stays CLOSED (we use SSM
 *     Session Manager instead, which is free and needs no open port 22).
 *   - instanceRole          : what the EC2 box is allowed to do at runtime
 *     (pull from ECR, read its one SSM secret, talk to SSM/CloudWatch).
 *
 * ECR pull is granted in the EC2 stack (where the repository object is in
 * scope) via repository.grantPull(instanceRole).
 */
export class SecurityStack extends Stack {
  public readonly instanceSecurityGroup: ec2.SecurityGroup;
  public readonly instanceRole: iam.Role;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;

    // ── Security group: public HTTP in, all out ────────────────────────────
    this.instanceSecurityGroup = new ec2.SecurityGroup(this, "InstanceSg", {
      vpc,
      securityGroupName: `weather-app-${config.envName}-ec2-sg`,
      description: "weather-app EC2: allow inbound HTTP only",
      allowAllOutbound: true,
    });
    this.instanceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(config.hostPort),
      `HTTP ${config.hostPort} from anywhere`,
    );
    // NOTE: deliberately NO port 22. Shell access is via SSM Session Manager.

    // ── EC2 instance role (least privilege) ────────────────────────────────
    this.instanceRole = new iam.Role(this, "InstanceRole", {
      roleName: `weather-app-${config.envName}-ec2-role`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "weather-app EC2 runtime role",
    });

    // SSM Session Manager + Run Command (no inbound SSH needed)
    this.instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
    );

    // Read ONLY this environment's OpenWeather key from Parameter Store
    const paramArn = Arn.format(
      {
        service: "ssm",
        resource: "parameter",
        // ssmKeyParamName begins with "/", strip it for the ARN resourceName
        resourceName: config.ssmKeyParamName.replace(/^\//, ""),
      },
      this,
    );
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadOpenWeatherKey",
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [paramArn],
      }),
    );

    // Decrypt the SecureString (default aws/ssm KMS key), scoped via condition
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DecryptSsmSecureString",
        actions: ["kms:Decrypt"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "kms:ViaService": `ssm.${config.region}.amazonaws.com`,
          },
        },
      }),
    );
  }
}
