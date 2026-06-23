import { Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { EnvConfig } from "../../config/env-config";

export interface VpcStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * Network foundation: a VPC with PUBLIC subnets only.
 *
 * Free-tier choices:
 *   - No NAT Gateway   (NAT costs ~$32/mo) -> EC2 lives in a public subnet.
 *   - Internet Gateway (free) provides outbound + inbound connectivity.
 *   - maxAzs from config (1 for dev). Bump for staging/prod with zero code change.
 */
export class VpcStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `weather-app-${config.envName}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
      maxAzs: config.maxAzs,
      natGateways: 0, // <-- free tier: no NAT
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
      // No private subnets in dev. Add SubnetType.PRIVATE_WITH_EGRESS here for
      // staging/prod (which would also set natGateways > 0).
    });
  }
}
