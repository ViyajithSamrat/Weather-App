import { Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";

export interface DockerEc2ConstructProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  role: iam.IRole;
  repository: ecr.IRepository;
}

/**
 * Reusable construct: a single t2.micro running the app container.
 *
 * Responsibilities:
 *   - Boot an Amazon Linux 2023 t2.micro in a public subnet with a public IP.
 *   - Install Docker via UserData.
 *   - Write /opt/deploy.sh — the idempotent "pull latest image + restart
 *     container" script that the CI/CD pipeline invokes through SSM Run Command.
 *   - Attach a stable Elastic IP so the URL never changes across restarts.
 *
 * Reused unchanged for every environment; only the injected config differs.
 */
export class DockerEc2Construct extends Construct {
  public readonly instance: ec2.Instance;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: DockerEc2ConstructProps) {
    super(scope, id);
    const { config, vpc, securityGroup, role, repository } = props;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
    const repoUri = repository.repositoryUri; // <registry>/weather-app-dev

    // ── UserData: install Docker + write the deploy script ─────────────────
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      "dnf update -y",
      "dnf install -y docker",
      "systemctl enable --now docker",
      // SSM agent ships preinstalled on Amazon Linux 2023.

      // Write the deploy script. The heredoc is single-quoted ('DEPLOY') so the
      // shell does NOT expand $KEY / $(...) at write time — they run later, when
      // the pipeline executes /opt/deploy.sh via SSM. The region/registry/repo/
      // param values below ARE interpolated now (CDK template strings).
      "cat > /opt/deploy.sh <<'DEPLOY'",
      "#!/bin/bash",
      "set -euxo pipefail",
      `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
      `docker pull ${repoUri}:latest`,
      `KEY=$(aws ssm get-parameter --name ${config.ssmKeyParamName} --with-decryption --region ${region} --query Parameter.Value --output text)`,
      "docker rm -f weather-app 2>/dev/null || true",
      `docker run -d --restart unless-stopped --name weather-app \\`,
      `  -p ${config.hostPort}:${config.appPort} \\`,
      `  -e OPENWEATHER_API_KEY="$KEY" \\`,
      `  -e NODE_ENV=production \\`,
      `  -e PORT=${config.appPort} \\`,
      `  -e NEXT_TELEMETRY_DISABLED=1 \\`,
      `  ${repoUri}:latest`,
      "DEPLOY",
      "chmod +x /opt/deploy.sh",

      // First boot: try an initial deploy. The pipeline hasn't pushed an image
      // yet on a brand-new env, so don't fail the instance if the pull 404s.
      "bash /opt/deploy.sh || echo 'no image yet - pipeline will deploy'",
    );

    this.instance = new ec2.Instance(this, "Instance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      securityGroup,
      role,
      userData,
      instanceName: `weather-app-${config.envName}`,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    // ── Stable public address ──────────────────────────────────────────────
    this.elasticIp = new ec2.CfnEIP(this, "Eip", {
      domain: "vpc",
      instanceId: this.instance.instanceId,
      tags: [{ key: "Name", value: `weather-app-${config.envName}-eip` }],
    });
  }
}
