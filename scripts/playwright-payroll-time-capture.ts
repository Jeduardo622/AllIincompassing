import http from "node:http";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

const PAYROLL_ROUTE_PATH = "/";
const PAYROLL_API_PATH = "/api/payroll-time-events";

type ProofSummary = {
  ok: boolean;
  baseUrl: string;
  queuedBeforeReconnect: number;
  queuedAfterReconnect: number;
  confirmedKeys: string[];
  requestLog: Array<{
    method: string;
    pathname: string;
    action: string | null;
    idempotencyKey: string | null;
  }>;
};

type ProofDependencies = {
  launchBrowser: () => Promise<Browser>;
};

const defaultDependencies: ProofDependencies = {
  launchBrowser: () => chromium.launch({ headless: true }),
};

const buildBrowserModule = async (): Promise<string> => {
  const entry = `
    import {
      createIndexedDbPayrollOutboxStore,
      drainPayrollOutbox,
      enqueuePayrollOutboxEvent,
      listPayrollOutboxEvents,
      recoverPayrollOutbox,
    } from "./src/features/payroll/outbox.ts";

    const scope = {
      organizationId: "observer-payroll-org",
      userId: "observer-payroll-user",
      localDate: "2026-08-11",
    };
    const store = createIndexedDbPayrollOutboxStore();

    const fetchMutation = async (idempotencyKey, action, event) => {
      const response = await fetch("/api/payroll-time-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ action, event }),
      });
      const parsed = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(parsed?.error ?? "payroll transport failed"), parsed);
      }
      return parsed;
    };

    const clearScopedEvents = async () => {
      const events = await listPayrollOutboxEvents(store, scope);
      for (const event of events) {
        await store.remove(event.storageKey);
      }
    };

    window.__payrollTimeProof = {
      async prepare() {
        await clearScopedEvents();
        await recoverPayrollOutbox(store, scope);
        return listPayrollOutboxEvents(store, scope);
      },
      async enqueueSyntheticEvents() {
        await enqueuePayrollOutboxEvent({
          store,
          ...scope,
          action: "record_time_event",
          idempotencyKey: "time-proof-key-1",
          occurredAt: "2026-08-11T16:00:00.000Z",
          payload: {
            occurredAt: "2026-08-11T16:00:00.000Z",
            timezone: "America/Los_Angeles",
            workLocation: "office",
            data: {
              eventType: "shift_started",
            },
          },
        });
        await enqueuePayrollOutboxEvent({
          store,
          ...scope,
          action: "record_session_attendance",
          idempotencyKey: "attendance-proof-key-1",
          occurredAt: "2026-08-11T16:05:00.000Z",
          payload: {
            occurredAt: "2026-08-11T16:05:00.000Z",
            timezone: "America/Los_Angeles",
            workLocation: "client_site",
            data: {
              eventType: "session_started",
              sessionId: "11111111-1111-1111-1111-111111111111",
            },
          },
        });
        return listPayrollOutboxEvents(store, scope);
      },
      async drain() {
        return drainPayrollOutbox({
          store,
          organizationId: scope.organizationId,
          userId: scope.userId,
          recordTimeEvent: ({ idempotencyKey, event }) =>
            fetchMutation(idempotencyKey, "record_time_event", event),
          recordSessionAttendance: ({ idempotencyKey, event }) =>
            fetchMutation(idempotencyKey, "record_session_attendance", event),
        });
      },
      async list() {
        return listPayrollOutboxEvents(store, scope);
      },
    };

    document.body.setAttribute("data-ready", "true");
  `;

  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: "payroll-time-proof-entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    target: "es2022",
  });

  return result.outputFiles[0]?.text ?? "";
};

const htmlDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Payroll Time Proof</title>
  </head>
  <body>
    <main>Payroll time proof</main>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;

const buildFailureSummary = (): ProofSummary => ({
  ok: false,
  baseUrl: "",
  queuedBeforeReconnect: 0,
  queuedAfterReconnect: 0,
  confirmedKeys: [],
  requestLog: [],
});

export const runPayrollTimeCaptureProof = async (
  deps: ProofDependencies = defaultDependencies,
): Promise<ProofSummary> => {
  const requestLog: ProofSummary["requestLog"] = [];
  const browserModule = await buildBrowserModule();

  const server = http.createServer(async (request, response) => {
    if (request.url === PAYROLL_ROUTE_PATH) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(htmlDocument);
      return;
    }

    if (request.url === "/app.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      response.end(browserModule);
      return;
    }

    if (request.url === PAYROLL_API_PATH && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        action?: string;
      };
      const idempotencyKey = request.headers["idempotency-key"];
      requestLog.push({
        method: "POST",
        pathname: PAYROLL_API_PATH,
        action: typeof parsedBody.action === "string" ? parsedBody.action : null,
        idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : null,
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "Idempotency-Key": typeof idempotencyKey === "string" ? idempotencyKey : "",
      });
      response.end(JSON.stringify({ idempotencyKey }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("payroll_time_proof_address_unavailable");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await deps.launchBrowser();

  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator("body[data-ready='true']").waitFor({ state: "attached", timeout: 15_000 });

    await page.evaluate(async () => {
      await window.__payrollTimeProof.prepare();
    });

    await context.setOffline(true);
    const queuedBeforeReconnect = await page.evaluate(async () => {
      await window.__payrollTimeProof.enqueueSyntheticEvents();
      await window.__payrollTimeProof.drain();
      return (await window.__payrollTimeProof.list()).length;
    });

    await context.setOffline(false);
    const drainResult = await page.evaluate(async () => window.__payrollTimeProof.drain());
    const queuedAfterReconnect = await page.evaluate(async () => (await window.__payrollTimeProof.list()).length);

    await context.close();

    return {
      ok:
        queuedBeforeReconnect === 2
        && queuedAfterReconnect === 0
        && JSON.stringify(drainResult.confirmedKeys) === JSON.stringify([
          "time-proof-key-1",
          "attendance-proof-key-1",
        ])
        && JSON.stringify(requestLog.map((entry) => entry.idempotencyKey)) === JSON.stringify([
          "time-proof-key-1",
          "attendance-proof-key-1",
        ]),
      baseUrl,
      queuedBeforeReconnect,
      queuedAfterReconnect,
      confirmedKeys: drainResult.confirmedKeys,
      requestLog,
    };
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

declare global {
  interface Window {
    __payrollTimeProof: {
      prepare: () => Promise<unknown>;
      enqueueSyntheticEvents: () => Promise<unknown>;
      drain: () => Promise<{ confirmedKeys: string[] }>;
      list: () => Promise<Array<{ idempotencyKey: string }>>;
    };
  }
}

const isMainModule = (): boolean =>
  typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule()) {
  runPayrollTimeCaptureProof().then(
    (summary) => {
      console.log(JSON.stringify(summary));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    },
    () => {
      console.error(JSON.stringify(buildFailureSummary()));
      process.exitCode = 1;
    },
  );
}
