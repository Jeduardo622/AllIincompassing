import { getOptionalServerEnv, getRequiredServerEnv } from "./env";

type EnvLoadOptions = {
  readonly envPath?: string;
};

type AdobePdfServicesCredentials = {
  clientId: string;
  clientSecret: string;
  organizationId?: string;
};

type AdobePdfServicesHeadersOptions = EnvLoadOptions & {
  readonly accessToken: string;
  readonly contentType?: string;
  readonly accept?: string;
};

export const ADOBE_PDF_SERVICES_BASE_URL = "https://pdf-services.adobe.io";
export const ADOBE_PDF_SERVICES_TOKEN_URL = `${ADOBE_PDF_SERVICES_BASE_URL}/token`;

const getAliasedRequiredEnv = (
  primaryKey: string,
  fallbackKey: string,
  options?: EnvLoadOptions,
): string => getOptionalServerEnv(primaryKey, options) ?? getRequiredServerEnv(fallbackKey, options);

export function getAdobePdfServicesCredentials(options?: EnvLoadOptions): AdobePdfServicesCredentials {
  const clientId = getAliasedRequiredEnv(
    "ADOBE_PDF_SERVICES_CLIENT_ID",
    "PDF_SERVICES_CLIENT_ID",
    options,
  );
  const clientSecret = getAliasedRequiredEnv(
    "ADOBE_PDF_SERVICES_CLIENT_SECRET",
    "PDF_SERVICES_CLIENT_SECRET",
    options,
  );
  const organizationId =
    getOptionalServerEnv("ADOBE_PDF_SERVICES_ORGANIZATION_ID", options) ??
    getOptionalServerEnv("PDF_SERVICES_ORGANIZATION_ID", options);

  return { clientId, clientSecret, organizationId };
}

export function buildAdobePdfServicesTokenHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

export function buildAdobePdfServicesTokenBody(options?: EnvLoadOptions): URLSearchParams {
  const { clientId, clientSecret } = getAdobePdfServicesCredentials(options);
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });
}

export function buildAdobePdfServicesApiHeaders({
  accessToken,
  contentType = "application/json",
  accept = "application/json",
  ...options
}: AdobePdfServicesHeadersOptions): Record<string, string> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error("Missing Adobe PDF Services access token.");
  }

  const { clientId } = getAdobePdfServicesCredentials(options);
  return {
    "X-API-Key": clientId,
    Authorization: `Bearer ${token}`,
    "Content-Type": contentType,
    Accept: accept,
  };
}
