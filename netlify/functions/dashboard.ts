import { Handler } from "@netlify/functions";
import { dashboardHandler } from "../../src/server/api/dashboard";

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

    const baseHeaders = event.headers as Record<string, string | undefined>;
    const mergedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(baseHeaders)) {
      if (typeof value === "string" && value.length > 0) {
        mergedHeaders[key] = value;
      }
    }
    const multiValue = (event as { multiValueHeaders?: Record<string, string[]> }).multiValueHeaders;
    if (multiValue) {
      for (const [key, values] of Object.entries(multiValue)) {
        if (!values || values.length === 0) continue;
        const lower = key.toLowerCase();
        const hasKey = Object.keys(mergedHeaders).some((existing) => existing.toLowerCase() === lower);
        if (!hasKey) {
          mergedHeaders[key] = values[0]!;
        }
      }
    }

    const request = new Request(event.rawUrl || `https://${event.headers.host}${event.path}`, {
      method: event.httpMethod,
      headers: mergedHeaders as HeadersInit,
      body,
    });

    const response = await dashboardHandler(request);
    return toNetlifyResponse(response);
  } catch {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
