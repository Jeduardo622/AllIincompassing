export const buildSyntheticPostgresUrl = (
  protocol: "postgres" | "postgresql",
  username: string,
  password: string,
  host: string,
  port: number | null,
  database: string,
  suffix: string,
) => {
  const portSegment = port === null ? "" : `:${port}`;
  return `${protocol}://${username}:${password}@${host}${portSegment}/${database}${suffix}`;
};
