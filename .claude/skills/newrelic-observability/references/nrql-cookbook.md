# NRQL cookbook

Run any of these with `bun scripts/nr.ts query "<NRQL>" | jq -c .`

## Errors

```sql
-- real app errors, grouped by shape
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' AND container_name='ai-listings' AND message NOT LIKE '[auth]%' AND message RLIKE '(?i).*(error|exception|fail|fatal).*' SINCE 1 hour ago FACET substring(message, 0, 70) LIMIT 15

-- error trend
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' AND message NOT LIKE '[auth]%' AND message RLIKE '(?i).*(error|exception|fatal).*' SINCE 6 hours ago TIMESERIES 15 minutes

-- Supabase errors by container
SELECT count(*) FROM Log WHERE namespace_name='sup-ai-listings' AND message RLIKE '(?i).*(error|fatal|panic).*' SINCE 1 hour ago FACET container_name
```

## Kubernetes state

```sql
-- restarts per pod
SELECT max(restartCount) FROM K8sContainerSample WHERE namespaceName IN ('ai-listings','sup-ai-listings') SINCE 1 day ago FACET podName LIMIT 20

-- deployments missing replicas
SELECT latest(podsMissing), latest(podsAvailable) FROM K8sDeploymentSample WHERE namespaceName IN ('ai-listings','sup-ai-listings') FACET deploymentName

-- crash loops and terminated reasons
SELECT latest(reason), latest(status) FROM K8sContainerSample WHERE namespaceName='ai-listings' FACET podName, containerName LIMIT 20
```

## Volume and freshness

```sql
-- is each container still logging?
SELECT latest(timestamp) FROM Log WHERE namespace_name='ai-listings' FACET container_name SINCE 1 hour ago

-- log volume by container
SELECT count(*) FROM Log WHERE namespace_name='ai-listings' SINCE 1 hour ago FACET container_name TIMESERIES 10 minutes
```

## Alerts

```sql
SELECT count(*) FROM NrAiIssue SINCE 1 day ago FACET priority, title LIMIT 20
```

## APM (once the Node agent is live)

```sql
SELECT percentile(duration, 95), rate(count(*), 1 minute), percentage(count(*), WHERE error IS true) FROM Transaction WHERE appName LIKE '%ai-listings%' SINCE 1 hour ago TIMESERIES 5 minutes
SELECT average(duration), count(*) FROM Transaction WHERE appName LIKE '%ai-listings%' SINCE 1 hour ago FACET name LIMIT 10
```
