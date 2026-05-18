import { Handler } from "@netlify/functions";
import {
  assessmentDocumentsHandler,
} from "../../src/server/api/assessment-documents";

type BackgroundScheduleArgs = Parameters<
  NonNullable<Parameters<typeof assessmentDocumentsHandler>[1]["scheduleCaloptimaExtraction"]>
>[0];

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

const scheduleBackgroundExtraction = async (
  request: Request,
  args: BackgroundScheduleArgs,
): Promise<boolean> => {
  const origin = new URL(request.url).origin;
  const backgroundHeaders = new Headers({
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.accessToken}`,
  });
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    backgroundHeaders.set("origin", requestOrigin);
  }

  const response = await fetch(`${origin}/.netlify/functions/assessment-documents-extract-background`, {
    method: "POST",
    headers: backgroundHeaders,
    body: JSON.stringify({
      assessment_document_id: args.createdDocumentId,
      client_id: args.clientId,
    }),
  });

  return response.ok;
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

    const response = await assessmentDocumentsHandler(request, {
      scheduleCaloptimaExtraction: async (args) => {
        const scheduled = await scheduleBackgroundExtraction(request, args);
        return { ok: scheduled, status: scheduled ? 202 : 500 };
      },
    });
    return toNetlifyResponse(response);
  } catch {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
