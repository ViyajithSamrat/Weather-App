import { EnvConfig } from "./env-config";

/**
 * DEV environment configuration — 100% AWS Free Tier.
 *
 * This is the ONLY environment implemented in Week 2. QA / staging / prod
 * are added later by creating qa.ts / staging.ts / prod.ts with the same shape.
 */
export const devConfig: EnvConfig = {
  envName: "dev",
  region: "us-east-1",
  account: process.env.CDK_DEFAULT_ACCOUNT,

  vpcCidr: "10.0.0.0/16",
  maxAzs: 1, // single AZ for dev — no HA needed, keeps it within free tier

  instanceType: "t2.micro", // 750 free hours/month

  ecrLifecycleCount: 3, // keep last 3 images (free tier = 500 MB)
  logRetentionDays: 7,

  appPort: 3000, // Next.js standalone server inside the container
  hostPort: 80, // public HTTP

  ssmKeyParamName: "/weather-app/dev/OPENWEATHER_API_KEY",

  github: {
    owner: "ViyajithSamrat",
    repo: "Weather-App",
    branch: "dev",
    // Replace after creating the connection once in the console:
    // AWS Console -> Developer Tools -> Settings -> Connections -> Create connection (GitHub)
    connectionArn:
      "arn:aws:codestar-connections:us-east-1:000000000000:connection/REPLACE_ME",
  },

  tags: {
    Application: "weather-app",
    Environment: "dev",
    ManagedBy: "cdk",
    CostCenter: "free-tier",
  },
};
