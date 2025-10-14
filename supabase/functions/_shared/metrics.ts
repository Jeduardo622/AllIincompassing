type MetricLabels = Record<string, string | number | boolean | null | undefined>;

export function increment(name: string, labels: MetricLabels = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level: "metric",
    metric: name,
    count: 1,
    ...sanitize(labels),
  };
  console.log(JSON.stringify(payload));
}

function sanitize(labels: MetricLabels): MetricLabels {
  return Object.entries(labels).reduce<MetricLabels>((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
}
