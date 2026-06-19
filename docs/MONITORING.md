# Monitoring & Observability Strategy

**Version:** 1.0
**Date:** 2026-06-19
**Status:** Phase 1 implemented (CloudWatch Logs) — Phase 2 planned (Alarms)

---

## Current State (Phase 1 — Implemented)

### What's Observable Right Now

| Signal | Tool | How to query |
|---|---|---|
| Container stdout/stderr | CloudWatch Logs `/weather-app/<env>/app` | See commands below |
| Docker build output | CloudWatch Logs `/aws/codebuild/weather-app-<env>-build` | CodeBuild console |
| Deploy execution | SSM Run Command history | SSM Console → Run Command |
| Pipeline state | CodePipeline | AWS Console |
| Network traffic | VPC Flow Logs `/weather-app/<env>/vpc-flow-logs` | CW Logs Insights |
| Container vulnerabilities | ECR scan-on-push | ECR Console → Images |
| HTTP surface tests | pytest smoke tests | GitHub Actions artifacts |
| Unit test coverage | Vitest + lcov | GitHub Actions + SonarCloud |

### Accessing Logs

```bash
# Live tail (like `tail -f` for CloudWatch)
aws logs tail /weather-app/prod/app \
  --follow \
  --region ap-south-1

# Last 100 lines
aws logs tail /weather-app/prod/app \
  --since 1h \
  --region ap-south-1

# Filter for errors only
aws logs filter-log-events \
  --log-group-name /weather-app/prod/app \
  --filter-pattern "ERROR" \
  --region ap-south-1 \
  --start-time $(date -d '-1 hour' +%s000)

# Build logs from last CodeBuild run
aws logs tail /aws/codebuild/weather-app-prod-build \
  --since 2h \
  --region ap-south-1

# VPC Flow Logs (who connected to port 80)
aws logs filter-log-events \
  --log-group-name /weather-app/prod/vpc-flow-logs \
  --filter-pattern "[version, account, eni, source, destination, srcport, destport=80, protocol, packets, bytes, windowstart, windowend, action, flowlogstatus]" \
  --region ap-south-1
```

---

## Phase 2 — Alerting (Week 4 Plan)

### CloudWatch Alarms to Create

#### 1. EC2 CPU Alarm

```typescript
// Add to ec2-stack.ts or a new monitoring-stack.ts
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";

const alarmTopic = new sns.Topic(this, "AlarmTopic");
alarmTopic.addSubscription(
  new sns_subscriptions.EmailSubscription("samratviyajith@gmail.com")
);

new cloudwatch.Alarm(this, "CpuAlarm", {
  metric: new cloudwatch.Metric({
    namespace: "AWS/EC2",
    metricName: "CPUUtilization",
    dimensionsMap: { InstanceId: instanceId },
    period: Duration.minutes(5),
    statistic: "Average",
  }),
  threshold: 80,
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  alarmDescription: `weather-app-${config.envName} CPU > 80% for 10 min`,
  treatMissingData: cloudwatch.TreatMissingData.BREACHING,
}).addAlarmAction(new cw_actions.SnsAction(alarmTopic));
```

#### 2. HTTP 5xx Rate Metric Filter

```typescript
// Add a metric filter on the container log group
const metricFilter = new logs.MetricFilter(this, "Http5xxFilter", {
  logGroup: logs.LogGroup.fromLogGroupName(
    this, "AppLogGroup", `/weather-app/${config.envName}/app`
  ),
  filterPattern: logs.FilterPattern.literal("5[0-9][0-9]"),
  metricNamespace: `WeatherApp/${config.envName}`,
  metricName: "Http5xxCount",
  metricValue: "1",
});

new cloudwatch.Alarm(this, "Http5xxAlarm", {
  metric: metricFilter.metric({ period: Duration.minutes(1) }),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: `5xx errors > 5/min in ${config.envName}`,
}).addAlarmAction(new cw_actions.SnsAction(alarmTopic));
```

#### 3. CodeBuild Failure Alarm

```typescript
new cloudwatch.Alarm(this, "BuildFailureAlarm", {
  metric: new cloudwatch.Metric({
    namespace: "AWS/CodeBuild",
    metricName: "FailedBuilds",
    dimensionsMap: { ProjectName: `weather-app-${config.envName}-build` },
    period: Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: `CodeBuild failed for weather-app-${config.envName}`,
}).addAlarmAction(new cw_actions.SnsAction(alarmTopic));
```

---

## Phase 3 — Structured Logging (Week 4)

### Current: Unstructured (Next.js default)

```
container log: GET /api/geocode?q=London 200 in 243ms
```

### Target: JSON structured logs

```json
{
  "timestamp": "2026-06-19T14:30:00.123Z",
  "level": "info",
  "method": "GET",
  "path": "/api/geocode",
  "status": 200,
  "duration_ms": 243,
  "query": "London",
  "env": "prod",
  "build": "abc1234"
}
```

Implementation: Add a custom Next.js logger middleware in `lib/logger.ts`.
This enables CloudWatch Logs Insights queries:

```
fields @timestamp, status, path, duration_ms
| filter status >= 500
| sort @timestamp desc
| limit 20
```

---

## Phase 4 — Production Dashboard (Future)

### CloudWatch Dashboard

```
┌──────────────────────┬──────────────────────┐
│  EC2 CPU %           │  HTTP 2xx/5xx Rate   │
│  [line chart 24h]    │  [stacked bar 24h]   │
├──────────────────────┼──────────────────────┤
│  Build Success Rate  │  Deploy Frequency    │
│  [number + trend]    │  [count/week]        │
├──────────────────────┼──────────────────────┤
│  Active Alarms       │  Recent Deploys      │
│  [list]              │  [timeline]          │
└──────────────────────┴──────────────────────┘
```

CDK implementation:
```typescript
new cloudwatch.Dashboard(this, "AppDashboard", {
  dashboardName: `weather-app-${config.envName}`,
  widgets: [/* ... */],
});
```

---

## Logging Strategy

### Log Retention Policy

| Environment | Retention | Reason |
|---|---|---|
| dev | 7 days | Fast iteration, no compliance need |
| prod | 30 days | Debugging window, lightweight compliance |

### Log Groups

| Group | Content | Retention |
|---|---|---|
| `/weather-app/<env>/app` | Container stdout/stderr | Per env config |
| `/weather-app/<env>/vpc-flow-logs` | Network accepted/rejected | 7 days |
| `/aws/codebuild/weather-app-<env>-build` | Build output | 90 days (AWS default) |

### No PII in Logs

Rules:
- Never log the OpenWeather API key or response body
- Never log user search queries with identifying information  
- Never log `OPENWEATHER_API_KEY` environment variable value
- `set -x` is BANNED from deploy.sh (would log decrypted SSM value)

---

## Scalability Discussion

### Current Bottlenecks

1. **Single EC2 instance** — no horizontal scaling. A viral post could spike CPU past 80%.
2. **No connection pooling** — each Next.js request creates a new connection to OpenWeather API.
3. **No caching** — same city requested 100× makes 100 API calls (OpenWeather free tier: 60 calls/min).

### Short-term Mitigations (Week 4)

- Add CloudWatch CPU alarm → manual scale-up when needed
- Add Next.js `revalidate` to cache weather responses for 10 min (reduces API calls ~90%)
- Move to t3.micro (same free tier eligible, better burst performance)

### Long-term (Week 5-6)

- Auto Scaling Group (min 2, max 4) → handle spikes automatically
- Application Load Balancer → distribute traffic across instances
- ElastiCache Redis → cache weather data server-side (< $15/month)
- CloudFront CDN → cache static assets globally (< $1/month at portfolio traffic)

---

## Production Readiness Checklist

### Security
- [x] Port 22 closed — SSM Session Manager only
- [x] Non-root container (nextjs uid 1001)
- [x] IMDSv2 required on EC2
- [x] EBS encrypted (gp3 AES-256)
- [x] API key never in git/image/buildspec
- [x] ECR scan-on-push for CVEs
- [x] VPC Flow Logs enabled
- [ ] HTTPS (ACM cert + ALB) — Week 4
- [ ] Security headers (CSP, HSTS, X-Frame) — Week 4
- [ ] WAF on ALB — Week 5

### Reliability
- [x] Container auto-restarts on crash (--restart unless-stopped)
- [x] Container survives EC2 reboot (same flag)
- [x] Elastic IP (stable URL across reboots)
- [x] Health check in Dockerfile (HEALTHCHECK directive)
- [x] Rollback procedure documented (ROLLBACK_SOP.md)
- [ ] CloudWatch CPU alarm — Week 4
- [ ] CodeBuild failure alert — Week 4
- [ ] Multi-AZ deployment — Week 5
- [ ] Health check endpoint `/api/health` — Week 4

### Observability
- [x] Container logs in CloudWatch
- [x] Build logs in CloudWatch
- [x] Deploy auditable via SSM history and CloudTrail
- [x] VPC traffic visible (Flow Logs)
- [ ] CloudWatch Dashboard — Week 4
- [ ] HTTP 5xx metric filter and alarm — Week 4
- [ ] Structured JSON logging — Week 4
- [ ] Response time tracking — Week 4

### Deployment
- [x] Production Gate (automated tests before merge)
- [x] Manual SNS approval before prod deploy
- [x] ECR image versioning (SHA tag + latest)
- [x] Docker layer cache (60% faster builds)
- [x] Rollback via previous ECR image
- [ ] Zero-downtime deploy (ALB blue/green) — Week 4
- [ ] Canary routing — Week 5
