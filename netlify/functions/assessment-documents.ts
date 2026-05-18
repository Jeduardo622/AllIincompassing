import { Handler, HandlerContext } from "@netlify/functions";
import { fetchJson } from "../../src/server/api/shared";
import {
  assessmentDocumentsExtractionBackgroundHandler,
  assessmentDocumentsHandler,
  persistCaloptimaExtractionScheduleFailure,
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

const shouldPersistScheduleFailure = async (args: BackgroundScheduleArgs): Promise<boolean> => {
  const documentResult = await fetchJson<Array<{ status?: string | null }>>(
    `${args.supabaseUrl}/rest/v1/assessment_documents?select=status&id=eq.${encodeURIComponent(
      args.createdDocumentId,
    )}&organization_id=eq.${encodeURIComponent(args.organizationId)}&limit=1`,
    {
      method: "GET",
      headers: args.headers,
    },
  );

  const documentStatus =
    documentResult.ok && Array.isArray(documentResult.data) && documentResult.data[0]
      ? documentResult.data[0].status
      : null;

  return documentStatus === "extracting" || documentStatus === "extraction_running";
};

const persistScheduleFailureIfPending = async (args: BackgroundScheduleArgs): Promise<void> => {
  if (!(await shouldPersistScheduleFailure(args))) {
    return;
  }

  await persistCaloptimaExtractionScheduleFailure({
    supabaseUrl: args.supabaseUrl,
    headers: args.headers,
    organizationId: args.organizationId,
    actorId: args.actorId,
    createdDocumentId: args.createdDocumentId,
    clientId: args.clientId,
  });
};

const scheduleBackgroundExtraction = (
  context: HandlerContext,
  request: Request,
  args: BackgroundScheduleArgs,
): boolean => {
  if (typeof context.waitUntil !== "function") {
    return false;
  }

  const origin = new URL(request.url).origin;
  const backgroundHeaders = new Headers({
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.accessToken}`,
  });
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    backgroundHeaders.set("origin", requestOrigin);
  }

  const trigger = (async () => {
    try {
      const response = await assessmentDocumentsExtractionBackgroundHandler(
        new Request(`${origin}/.netlify/functions/assessment-documents-extract-background`, {
          method: "POST",
          headers: backgroundHeaders,
          body: JSON.stringify({
            assessment_document_id: args.createdDocumentId,
            client_id: args.clientId,
          }),
        }),
      );

      if (!response.ok) {
        throw new Error("background extraction enqueue failed");
      }
    } catch {
      await persistScheduleFailureIfPending(args);
    }
  })();

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
