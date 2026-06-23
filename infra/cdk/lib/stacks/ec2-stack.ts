import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";
import { DockerEc2Construct } from "../constructs/docker-ec2-construct";

export interface Ec2StackProps extends StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  instanceRole: iam.IRole;
  repository: ecr.IRepository;
}

/**
 * The compute layer: one t2.micro running the Dockerised app.
 *
 * Thin wrapper around DockerEc2Construct. Also wires the ECR pull grant here
 * (the repository object lives in the ECR stack and is passed in as a prop),
 * and exposes the instance id + public URL for the pipeline stack to consume.
 */
export class Ec2Stack extends Stack {
  public readonly instanceId: string;
  public readonly publicUrl: string;

  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);
    const { config, vpc, securityGroup, instanceRole, repository } = props;

    const ec2Construct = new DockerEc2Construct(this, "DockerEc2", {
      config,
      vpc,
      securityGroup,
      role: instanceRole,
      repository,
    });

    // Let the instance pull images from ECR (adds policy to the role).
    repository.grantPull(instanceRole);

    this.instanceId = ec2Construct.instance.instanceId;
    this.publicUrl = `http://${ec2Construct.elasticIp.ref}`;

    new CfnOutput(this, "InstanceId", {
      value: this.instanceId,
      description: "EC2 instance id (pipeline targets this via SSM)",
      exportName: `weather-app-${config.envName}-instance-id`,
    });
    new CfnOutput(this, "PublicUrl", {
      value: this.publicUrl,
      description: "Public URL of the running app",
      exportName: `weather-app-${config.envName}-url`,
    });
    new CfnOutput(this, "ElasticIp", {
      value: ec2Construct.elasticIp.ref,
      description: "Stable Elastic IP",
    });
  }
}
