# NRQL cookbook

Run any of these with `bun scripts/nr.ts query "<NRQL>" | jq -c .`

## Errors

Real app errors grouped by shape. Results can contain user ids, so show only counts and patterns.

```sql
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' AND container_name='ai-listings' AND message NOT LIKE '%"event":"proxy_check"%' AND message NOT LIKE '%"event":"proxy_redirect_to_login"%' AND message RLIKE '(?i).*(error|exception|fail|fatal).*' SINCE 1 hour ago FACET substring(message, 0, 45) LIMIT 15
```

Error trend.

```sql
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' AND message NOT LIKE '%"event":"proxy_check"%' AND message NOT LIKE '%"event":"proxy_redirect_to_login"%' AND message RLIKE '(?i).*(error|exception|fatal).*' SINCE 6 hours ago TIMESERIES 15 minutes
```

Supabase errors by container.

```sql
SELECT count(*) FROM Log WHERE namespace_name='sup-ai-listings' AND message RLIKE '(?i).*(error|fatal|panic).*' SINCE 1 hour ago FACET container_name
```

## Kubernetes state

Restarts per pod.

```sql
SELECT max(restartCount) FROM K8sContainerSample WHERE namespaceName IN ('ai-listings','sup-ai-listings') SINCE 1 day ago FACET podName LIMIT 20
```

Deployments missing replicas.

```sql
SELECT latest(podsMissing), latest(podsAvailable) FROM K8sDeploymentSample WHERE namespaceName IN ('ai-listings','sup-ai-listings') FACET deploymentName
```

Crash loops. CronJob pods such as `inngest-healthcheck` show `Error` or `Terminated` normally, so this keeps only `CrashLoopBackOff`.

```sql
SELECT latest(reason), latest(status), max(restartCount) FROM K8sContainerSample WHERE namespaceName='ai-listings' AND reason = 'CrashLoopBackOff' AND status != 'Terminated' FACET podName, containerName LIMIT 20
```

## Volume and freshness

Is each container still logging?

```sql
SELECT latest(timestamp) FROM Log WHERE namespace_name='ai-listings' FACET container_name SINCE 1 hour ago
```

Log volume by container.

```sql
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' SINCE 1 hour ago FACET container_name TIMESERIES 10 minutes
```

## Alerts

Issues for this app. The condition name is inside `title`.

```sql
SELECT count(*) FROM NrAiIssue WHERE title LIKE '%ai-listings%' SINCE 1 day ago FACET priority, title LIMIT 20
```

Cluster-wide.

```sql
SELECT count(*) FROM NrAiIssue SINCE 1 day ago FACET priority, title LIMIT 20
```

## APM (once the Node agent is live)

`Transaction` returns nothing until the app runs the New Relic agent. An empty result means no agent, not no traffic.

```sql
SELECT percentile(duration, 95), rate(count(*), 1 minute), percentage(count(*), WHERE error IS true) FROM Transaction WHERE appName LIKE '%ai-listings%' SINCE 1 hour ago TIMESERIES 5 minutes
```

```sql
SELECT average(duration), count(*) FROM Transaction WHERE appName LIKE '%ai-listings%' SINCE 1 hour ago FACET name LIMIT 10
```
