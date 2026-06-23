/**
 * EnvConfig — the contract every environment (dev/qa/staging/prod) must satisfy.
 *
 * Adding a new environment later means creating a new file (e.g. qa.ts) that
 * exports an object of this shape. No stack logic ever changes.
 */
export interface GitHubSource {
  /** GitHub org/user that owns the repo. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Branch the pipeline watches and deploys from. */
  branch: string;
  /**
   * CodeStar Connections ARN authorising AWS to read the repo.
   * Created ONCE, manually, in the console (cannot be automated by IaC).
   * arn:aws:codestar-connections:<region>:<account>:connection/<uuid>
   */
  connectionArn: string;
}

export interface EnvConfig {
  /** Logical environment name: dev | qa | staging | prod. Used in every stack name. */
  envName: string;
  /** AWS region. */
  region: string;
  /** AWS account id. Read from CDK_DEFAULT_ACCOUNT at synth time. */
  account?: string;

  /** VPC CIDR. Each env gets a distinct range so they never overlap if peered. */
  vpcCidr: string;
  /** Number of AZs. 1 for dev (cost), 2+ for staging/prod (HA). */
  maxAzs: number;

  /** EC2 instance type. t2.micro is free-tier (750 hrs/month). */
  instanceType: string;

  /** Keep at most N images in ECR (free tier = 500 MB). */
  ecrLifecycleCount: number;
  /** CloudWatch log retention in days. */
  logRetentionDays: number;

  /** Container's internal port (Next.js standalone server). */
  appPort: number;
  /** Host port exposed to the internet (HTTP). */
  hostPort: number;

  /**
   * SSM Parameter Store path holding the OpenWeather API key (SecureString).
   * The VALUE is seeded out-of-band (scripts/seed-ssm.sh) and never lives in code.
   */
  ssmKeyParamName: string;

  github: GitHubSource;

  /** Tags applied to every resource in the environment. */
  tags: Record<string, string>;
}
