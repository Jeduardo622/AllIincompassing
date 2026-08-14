import { Handler } from "@netlify/functions";
import { payrollAdministrationHandler } from "../../src/server/api/payroll-administration";
import { errorResponse } from "../../src/server/api/shared";

const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;

const toNetlifyResponse = async (response: Response) => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false,
  };
};

export const handler: Handler = async (event) => {
  try {
    const bodyNeeded = event.httpMethod !== "GET" && event.httpMethod !== "HEAD";
    const body =
      bodyNeeded && event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined;

    const request = new Request(event.rawUrl || `https://${event.headers.host}${event.path}`, {
      method: event.httpMethod,
      headers: event.headers as HeadersInit,
      body,
    });

    const response = await payrollAdministrationHandler(request);
    return toNetlifyResponse(response);
  } catch {
    const request = new Request("https://netlify.internal/api/payroll-administration", {
      headers: event.headers as HeadersInit,
    });
    const traceHeaders = TRACE_HEADER_NAMES.reduce<Record<string, string>>((headers, name) => {
      const value = request.headers.get(name)?.trim();
      if (value) {
        headers[name] = value;
      }
      return headers;
    }, {});
    return toNetlifyResponse(errorResponse(request, "internal_error", "Internal server error", {
      status: 500,
      headers: traceHeaders,
    }));
  }
};
