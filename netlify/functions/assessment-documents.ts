import { Handler, HandlerContext } from "@netlify/functions";
import {
  assessmentDocumentsHandler,
  persistCaloptimaExtractionScheduleFailure,
} from "../../src/server/api/assessment-documents";

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

const scheduleBackgroundExtraction = (
  context: HandlerContext,
  request: Request,
  args: Parameters<NonNullable<Parameters<typeof assessmentDocumentsHandler>[1]["scheduleCaloptimaExtraction"]>>[0],
): boolean => {
  if (typeof context.waitUntil !== "function") {
    return false;
  }

  const origin = new URL(request.url).origin;
  const trigger = fetch(`${origin}/.netlify/functions/assessment-documents-extract-background`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({ assessment_document_id: args.createdDocumentId }),
  }).then((response) => {
    if (!response.ok) {
      throw new Error("background extraction trigger failed");
    }
  }).catch(() =>
    persistCaloptimaExtractionScheduleFailure({
      supabaseUrl: args.supabaseUrl,
      headers: args.headers,
      organizationId: args.organizationId,
      actorId: args.actorId,
      createdDocumentId: args.createdDocumentId,
      clientId: args.clientId,
    }),
  );

  context.waitUntil(trigger);
  return true;
};

export const handler: Handler = async (event, context) => {
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
        const scheduled = scheduleBackgroundExtraction(context, request, args);
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
