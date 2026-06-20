# Authorization PDF Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-side extraction-assisted prefill for uploaded authorization PDFs in the existing admin/super-admin pre-authorization wizard.

**Architecture:** Keep extraction local to the browser with a small PDF text helper, parse extracted text through a pure deterministic authorization parser, then merge recognized values into the existing wizard without overwriting admin-entered fields. The save path remains the existing `createAuthorizationWithServices` RPC plus document upload flow.

**Tech Stack:** React 18, Vite, TypeScript, Vitest, Testing Library, Supabase client, `pdfjs-dist` for embedded PDF text extraction.

---

## Route And Scope

- `exact issue key used`: `WIN-179`
- `classification`: `high-risk human-reviewed`
- `lane`: `critical`
- `reviewer required`: yes
- `verify-change required`: yes
- `linear required`: yes

Allowed implementation surfaces:

- `package.json`
- `package-lock.json`
- `src/lib/authorizations/pdfText.ts`
- `src/lib/authorizations/pdfPrefill.ts`
- `src/lib/authorizations/__tests__/pdfPrefill.test.ts`
- `src/components/ClientDetails/PreAuthTab.tsx`
- `src/components/__tests__/PreAuthTab.test.tsx`

Non-goals:

- No server-side OCR.
- No AI extraction.
- No Supabase schema, RLS, RPC, grant, migration, or storage policy changes.
- No BT/therapist access changes.
- No raw extracted text logging or persistence.

Stop conditions:

- Stop and re-route if implementation needs `src/server/**`, `supabase/**`, route guards, auth context changes, or external OCR/API credentials.
- Stop if `pdfjs-dist` does not work in the Vite build without config changes beyond package dependency/import setup.
- Stop if parser behavior would require storing raw text or committing real document fixtures.

## File Responsibilities

- `src/lib/authorizations/pdfText.ts`: browser-only embedded PDF text extraction wrapper.
- `src/lib/authorizations/pdfPrefill.ts`: pure parsing and merge helpers for authorization prefill values.
- `src/lib/authorizations/__tests__/pdfPrefill.test.ts`: synthetic parser and merge unit tests.
- `src/components/ClientDetails/PreAuthTab.tsx`: upload-step extraction state, prefill application, and status banner.
- `src/components/__tests__/PreAuthTab.test.tsx`: wizard integration tests with mocked PDF text extraction.

---

### Task 1: Add PDF Text Extraction Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install `pdfjs-dist`**

Run:

```powershell
npm install pdfjs-dist
```

Expected: `package.json` includes `pdfjs-dist` under `dependencies`, and `package-lock.json` is updated.

- [ ] **Step 2: Confirm dependency only**

Run:

```powershell
git diff -- package.json package-lock.json
```

Expected: dependency lockfile changes only. No application code changed by this task.

- [ ] **Step 3: Commit dependency**

Run:

```powershell
git add package.json package-lock.json
git commit -m "build: add WIN-179 PDF text extraction dependency"
```

Expected: commit succeeds. If the pre-commit hook runs policy checks, record the result.

---

### Task 2: Add Parser And Merge Unit Tests

**Files:**
- Create: `src/lib/authorizations/__tests__/pdfPrefill.test.ts`

- [ ] **Step 1: Write failing parser and merge tests**

Create `src/lib/authorizations/__tests__/pdfPrefill.test.ts` with synthetic-only text:

```ts
import { describe, expect, it } from "vitest";
import {
  mergeAuthorizationPdfPrefill,
  parseAuthorizationPdfText,
  type AuthorizationPdfPrefill,
} from "../pdfPrefill";

describe("parseAuthorizationPdfText", () => {
  it("extracts IEHP-style authorization fields from synthetic notice text", () => {
    const text = `
      Referral ID: IEHP-AUTH-12345
      Status: Approved
      Member ID: MEM-0001
      Diagnosis: F84.0 Autistic disorder
      Service From: 06/23/2026
      Service To: 12/22/2026
      Procedure Code 97153
      Requested Units: 120
      Approved Units: 96
    `;

    expect(parseAuthorizationPdfText(text)).toEqual({
      authorizationNumber: "IEHP-AUTH-12345",
      status: "approved",
      memberId: "MEM-0001",
      diagnosisCode: "F84.0",
      diagnosisDescription: "Autistic disorder",
      startDate: "2026-06-23",
      endDate: "2026-12-22",
      services: [{ serviceCode: "97153", requestedUnits: 120, approvedUnits: 96 }],
    });
  });

  it("extracts CalOptima-style authorization fields from synthetic notice text", () => {
    const text = `
      Authorization #: CAL-987654
      Decision: Approved
      CIN: CIN-222333
      ICD-10 Code F84.0 - Autistic disorder
      Code Description From To Requested Approved
      97155 Adaptive behavior treatment 6.23.2026 12.22.2026 48 40
    `;

    expect(parseAuthorizationPdfText(text)).toMatchObject({
      authorizationNumber: "CAL-987654",
      status: "approved",
      memberId: "CIN-222333",
      diagnosisCode: "F84.0",
      diagnosisDescription: "Autistic disorder",
      startDate: "2026-06-23",
      endDate: "2026-12-22",
      services: [{ serviceCode: "97155", requestedUnits: 48, approvedUnits: 40 }],
    });
  });

  it("leaves ambiguous values unset", () => {
    expect(parseAuthorizationPdfText("Authorization notice with no structured values")).toEqual({
      services: [],
    });
  });
});

describe("mergeAuthorizationPdfPrefill", () => {
  const catalog = {
    "97153": "Adaptive behavior treatment by protocol",
    "97155": "Adaptive behavior treatment with protocol modification",
  };

  it("fills empty fields and catalog-matched services without overwriting entered values", () => {
    const current = {
      authorizationNumber: "ADMIN-TYPED",
      status: "pending" as const,
      startDate: "",
      endDate: "",
      diagnosisCode: "F84.0",
      diagnosisDescription: "Autistic disorder",
      memberId: "",
      services: [] as string[],
      units: {} as Record<string, number>,
    };
    const prefill: AuthorizationPdfPrefill = {
      authorizationNumber: "PDF-AUTH-1",
      status: "approved",
      startDate: "2026-06-23",
      endDate: "2026-12-22",
      memberId: "MEM-0001",
      services: [
        { serviceCode: "97153", requestedUnits: 120, approvedUnits: 96 },
        { serviceCode: "99999", requestedUnits: 1, approvedUnits: 1 },
      ],
    };

    expect(mergeAuthorizationPdfPrefill(current, prefill, catalog)).toEqual({
      data: {
        authorizationNumber: "ADMIN-TYPED",
        status: "pending",
        startDate: "2026-06-23",
        endDate: "2026-12-22",
        diagnosisCode: "F84.0",
        diagnosisDescription: "Autistic disorder",
        memberId: "MEM-0001",
        services: ["97153"],
        units: { "97153": 96 },
      },
      appliedFields: ["startDate", "endDate", "memberId", "services", "units"],
      skippedServiceCodes: ["99999"],
    });
  });

  it("does not replace units for a service already selected by the admin", () => {
    const current = {
      authorizationNumber: "",
      status: "approved" as const,
      startDate: "",
      endDate: "",
      diagnosisCode: "",
      diagnosisDescription: "",
      memberId: "",
      services: ["97153"],
      units: { "97153": 44 },
    };

    expect(
      mergeAuthorizationPdfPrefill(
        current,
        { services: [{ serviceCode: "97153", requestedUnits: 120, approvedUnits: 96 }] },
        catalog,
      ).data.units,
    ).toEqual({ "97153": 44 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```powershell
npm test -- src/lib/authorizations/__tests__/pdfPrefill.test.ts
```

Expected: FAIL because `src/lib/authorizations/pdfPrefill.ts` does not exist.

- [ ] **Step 3: Commit failing tests only if following strict checkpointing**

Preferred for this repo: do not leave failing tests committed. Continue directly to Task 3, then commit tests plus implementation together.

---

### Task 3: Implement Pure Parser And Merge Helper

**Files:**
- Create: `src/lib/authorizations/pdfPrefill.ts`
- Test: `src/lib/authorizations/__tests__/pdfPrefill.test.ts`

- [ ] **Step 1: Add parser and merge helper**

Create `src/lib/authorizations/pdfPrefill.ts`:

```ts
export type AuthorizationPdfStatus = "approved" | "pending" | "denied";

export interface AuthorizationPdfPrefillService {
  serviceCode: string;
  requestedUnits?: number;
  approvedUnits?: number;
}

export interface AuthorizationPdfPrefill {
  authorizationNumber?: string;
  status?: AuthorizationPdfStatus;
  startDate?: string;
  endDate?: string;
  diagnosisCode?: string;
  diagnosisDescription?: string;
  memberId?: string;
  services: AuthorizationPdfPrefillService[];
}

export interface AuthorizationPdfMergeInput {
  authorizationNumber: string;
  status: AuthorizationPdfStatus;
  startDate: string;
  endDate: string;
  diagnosisCode: string;
  diagnosisDescription: string;
  memberId: string;
  services: string[];
  units: Record<string, number>;
}

export interface AuthorizationPdfMergeResult<T extends AuthorizationPdfMergeInput> {
  data: T;
  appliedFields: string[];
  skippedServiceCodes: string[];
}

const DATE_PATTERN = String.raw`(?:\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})`;
const SERVICE_CODE_PATTERN = /\b(?:97(?:153|155|156|158)|0362T|0373T|H\d{4}|[A-Z]\d{4})\b/g;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeDate = (value: string): string | undefined => {
  const raw = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  const dateMatch = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(raw);
  if (!dateMatch) {
    return undefined;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) {
    return undefined;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const firstMatch = (text: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    const value = match?.[1]?.trim();
    if (value) {
      return collapseWhitespace(value);
    }
  }
  return undefined;
};

const parseStatus = (text: string): AuthorizationPdfStatus | undefined => {
  if (/\bdenied\b/i.test(text)) return "denied";
  if (/\bapproved\b/i.test(text)) return "approved";
  if (/\bpending\b|\brequested\b/i.test(text)) return "pending";
  return undefined;
};

const parseDates = (text: string): Pick<AuthorizationPdfPrefill, "startDate" | "endDate"> => {
  const serviceRange = new RegExp(`(?:service\\s*)?(?:from|start)\\s*:?\\s*(${DATE_PATTERN})[\\s\\S]{0,80}?(?:to|end)\\s*:?\\s*(${DATE_PATTERN})`, "i").exec(text);
  if (serviceRange) {
    return {
      startDate: normalizeDate(serviceRange[1]),
      endDate: normalizeDate(serviceRange[2]),
    };
  }

  const compactRange = new RegExp(`(${DATE_PATTERN})\\s*(?:-|to|through)\\s*(${DATE_PATTERN})`, "i").exec(text);
  if (compactRange) {
    return {
      startDate: normalizeDate(compactRange[1]),
      endDate: normalizeDate(compactRange[2]),
    };
  }

  return {};
};

const parseDiagnosis = (text: string): Pick<AuthorizationPdfPrefill, "diagnosisCode" | "diagnosisDescription"> => {
  const match = /\b(?:diagnosis|icd-?10(?: code)?)\s*:?\s*([A-Z]\d{2}(?:\.\d+)?)\s*(?:-|:)?\s*([A-Za-z][^\n\r]{2,80})?/i.exec(text);
  if (!match) {
    return {};
  }
  return {
    diagnosisCode: match[1].toUpperCase(),
    diagnosisDescription: match[2] ? collapseWhitespace(match[2]) : undefined,
  };
};

const parseServices = (text: string): AuthorizationPdfPrefillService[] => {
  const services = new Map<string, AuthorizationPdfPrefillService>();
  const lines = text.split(/\r?\n/).map(collapseWhitespace).filter(Boolean);

  for (const line of lines) {
    const codes = [...line.matchAll(SERVICE_CODE_PATTERN)].map((match) => match[0].toUpperCase());
    for (const serviceCode of codes) {
      const existing = services.get(serviceCode) ?? { serviceCode };
      const requested = /requested(?:\s+units)?\s*:?\s*(\d+)/i.exec(line)?.[1];
      const approved = /approved(?:\s+units)?\s*:?\s*(\d+)/i.exec(line)?.[1];
      const trailingNumbers = line.match(/\b\d+\b/g)?.map(Number).filter((value) => value > 0) ?? [];

      services.set(serviceCode, {
        serviceCode,
        requestedUnits: requested ? Number(requested) : existing.requestedUnits ?? trailingNumbers.at(-2),
        approvedUnits: approved ? Number(approved) : existing.approvedUnits ?? trailingNumbers.at(-1),
      });
    }
  }

  return [...services.values()];
};

export const parseAuthorizationPdfText = (text: string): AuthorizationPdfPrefill => {
  const normalizedText = text.replace(/\u00a0/g, " ");
  const authorizationNumber = firstMatch(normalizedText, [
    /\b(?:authorization|auth)\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
    /\breferral\s*(?:id|#|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
  ]);
  const memberId = firstMatch(normalizedText, [
    /\bmember\s*(?:id|#|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
    /\bcin\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
  ]);

  return {
    authorizationNumber,
    status: parseStatus(normalizedText),
    memberId,
    ...parseDiagnosis(normalizedText),
    ...parseDates(normalizedText),
    services: parseServices(normalizedText),
  };
};

export const mergeAuthorizationPdfPrefill = <T extends AuthorizationPdfMergeInput>(
  current: T,
  prefill: AuthorizationPdfPrefill,
  serviceCatalog: Record<string, string>,
): AuthorizationPdfMergeResult<T> => {
  const next: T = {
    ...current,
    services: [...current.services],
    units: { ...current.units },
  };
  const appliedFields = new Set<string>();
  const skippedServiceCodes = new Set<string>();

  const fillIfBlank = <K extends keyof T>(field: K, value: T[K] | undefined) => {
    if (!next[field] && value) {
      next[field] = value;
      appliedFields.add(String(field));
    }
  };

  fillIfBlank("authorizationNumber", prefill.authorizationNumber as T["authorizationNumber"]);
  fillIfBlank("startDate", prefill.startDate as T["startDate"]);
  fillIfBlank("endDate", prefill.endDate as T["endDate"]);
  fillIfBlank("diagnosisCode", prefill.diagnosisCode as T["diagnosisCode"]);
  fillIfBlank("diagnosisDescription", prefill.diagnosisDescription as T["diagnosisDescription"]);
  fillIfBlank("memberId", prefill.memberId as T["memberId"]);

  if (prefill.status && !current.status) {
    next.status = prefill.status as T["status"];
    appliedFields.add("status");
  }

  for (const service of prefill.services) {
    const code = service.serviceCode.toUpperCase();
    if (!serviceCatalog[code]) {
      skippedServiceCodes.add(code);
      continue;
    }
    if (!next.services.includes(code)) {
      next.services.push(code);
      appliedFields.add("services");
    }
    const units = service.approvedUnits ?? service.requestedUnits;
    if (units && units > 0 && !next.units[code]) {
      next.units[code] = units;
      appliedFields.add("units");
    }
  }

  return {
    data: next,
    appliedFields: [...appliedFields],
    skippedServiceCodes: [...skippedServiceCodes],
  };
};
```

- [ ] **Step 2: Run parser tests**

Run:

```powershell
npm test -- src/lib/authorizations/__tests__/pdfPrefill.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit parser**

Run:

```powershell
git add src/lib/authorizations/pdfPrefill.ts src/lib/authorizations/__tests__/pdfPrefill.test.ts
git commit -m "feat: add WIN-179 authorization PDF prefill parser"
```

---

### Task 4: Add Browser PDF Text Extraction Helper

**Files:**
- Create: `src/lib/authorizations/pdfText.ts`

- [ ] **Step 1: Add extraction helper**

Create `src/lib/authorizations/pdfText.ts`:

```ts
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_MIME_TYPE = "application/pdf";

export class PdfTextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfTextExtractionError";
  }
}

export const extractPdfText = async (file: File): Promise<string> => {
  if (file.type !== PDF_MIME_TYPE && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new PdfTextExtractionError("Only PDF files can be parsed for authorization prefill.");
  }

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const document = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (text.trim()) {
      pageTexts.push(text);
    }
  }

  const text = pageTexts.join("\n").trim();
  if (!text) {
    throw new PdfTextExtractionError("No embedded PDF text was found.");
  }

  return text;
};
```

- [ ] **Step 2: Typecheck helper**

Run:

```powershell
npm run typecheck
```

Expected: PASS. If `pdfjs-dist` type imports differ for the installed version, adjust imports in `pdfText.ts` only.

- [ ] **Step 3: Commit helper**

Run:

```powershell
git add src/lib/authorizations/pdfText.ts
git commit -m "feat: add WIN-179 browser PDF text extraction"
```

---

### Task 5: Add Wizard Prefill Integration Tests

**Files:**
- Modify: `src/components/__tests__/PreAuthTab.test.tsx`

- [ ] **Step 1: Mock PDF extraction**

Add `extractPdfTextMock` to the hoisted mock block:

```ts
const extractPdfTextMock = vi.fn();
```

Return it from the hoisted object and add:

```ts
vi.mock("../../lib/authorizations/pdfText", () => ({
  extractPdfText: extractPdfTextMock,
}));
```

Reset it in `beforeEach`:

```ts
extractPdfTextMock.mockResolvedValue("");
```

- [ ] **Step 2: Add prefill integration test**

Append this test to `PreAuthTab.test.tsx`:

```ts
it("prefills empty wizard fields from uploaded PDF text and submits reviewed values", async () => {
  extractPdfTextMock.mockResolvedValue(`
    Authorization #: PDF-AUTH-777
    Status: Approved
    Member ID: MEM-PDF-777
    Diagnosis: F84.0 Autistic disorder
    Service From: 06/23/2026
    Service To: 12/22/2026
    Procedure Code 97153
    Approved Units: 96
  `);

  const user = userEvent.setup();
  renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

  await user.click(screen.getByRole("button", { name: /new authorization/i }));
  await screen.findByRole("heading", { name: /authorization notice details/i });
  await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
  await waitFor(() => {
    expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
  });
  await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");

  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["synthetic pdf bytes"], "prefill-auth.pdf", { type: "application/pdf" });
  await user.upload(fileInput, file);

  expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /next/i }));
  expect(screen.getByText(/PDF-AUTH-777/)).toBeInTheDocument();
  expect(screen.getByText(/2026-06-23 - 2026-12-22/)).toBeInTheDocument();
  expect(screen.getByText(/97153/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /submit request/i }));

  await waitFor(() => {
    expect(createAuthorizationWithServices).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_number: "PDF-AUTH-777",
        member_id: "MEM-PDF-777",
        start_date: "2026-06-23",
        end_date: "2026-12-22",
        services: [
          expect.objectContaining({
            service_code: "97153",
            requested_units: 96,
            approved_units: 96,
          }),
        ],
      }),
    );
  });
});
```

- [ ] **Step 3: Add no-overwrite integration test**

Append:

```ts
it("does not overwrite admin-entered notice fields when PDF prefill runs", async () => {
  extractPdfTextMock.mockResolvedValue(`
    Authorization #: PDF-AUTH-SHOULD-NOT-WIN
    Service From: 06/23/2026
    Service To: 12/22/2026
    Procedure Code 97153
    Approved Units: 96
  `);

  const user = userEvent.setup();
  renderWithProviders(<PreAuthTab client={{ id: "client-1" }} />, { auth: false });

  await user.click(screen.getByRole("button", { name: /new authorization/i }));
  await screen.findByRole("heading", { name: /authorization notice details/i });
  await user.type(screen.getByLabelText(/authorization number/i), "ADMIN-AUTH-1");
  await user.selectOptions(await screen.findByLabelText(/insurance provider/i), "payer-1");
  await waitFor(() => {
    expect(screen.getByLabelText(/rendering therapist/i)).toHaveValue("therapist-provider-1");
  });
  await user.selectOptions(screen.getByLabelText(/plan type/i), "Medicaid");

  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, new File(["synthetic pdf bytes"], "prefill-auth.pdf", { type: "application/pdf" }));
  expect(await screen.findByText(/PDF prefill applied/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /next/i }));
  expect(screen.getByText(/ADMIN-AUTH-1/)).toBeInTheDocument();
  expect(screen.queryByText(/PDF-AUTH-SHOULD-NOT-WIN/)).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run component tests and confirm they fail**

Run:

```powershell
npm test -- src/components/__tests__/PreAuthTab.test.tsx
```

Expected: FAIL because `PreAuthTab.tsx` does not call `extractPdfText` or render status yet.

---

### Task 6: Implement Wizard Extraction State And UI Banner

**Files:**
- Modify: `src/components/ClientDetails/PreAuthTab.tsx`
- Test: `src/components/__tests__/PreAuthTab.test.tsx`

- [ ] **Step 1: Import helpers**

Add imports:

```ts
import { extractPdfText, PdfTextExtractionError } from '../../lib/authorizations/pdfText';
import { mergeAuthorizationPdfPrefill, parseAuthorizationPdfText } from '../../lib/authorizations/pdfPrefill';
```

- [ ] **Step 2: Add extraction state type near wizard data**

Add:

```ts
type PdfPrefillState =
  | { status: 'idle' }
  | { status: 'extracting'; fileName: string }
  | { status: 'applied'; appliedFields: string[]; skippedServiceCodes: string[] }
  | { status: 'no_text'; fileName: string }
  | { status: 'failed'; fileName: string; message: string };
```

- [ ] **Step 3: Add component state**

Inside `PreAuthTab` state declarations:

```ts
const [pdfPrefillState, setPdfPrefillState] = useState<PdfPrefillState>({ status: 'idle' });
```

- [ ] **Step 4: Reset state on successful submit and wizard cancel/open**

After successful submit reset:

```ts
setPdfPrefillState({ status: 'idle' });
```

Replace `onClick={() => setIsWizardOpen(true)}` for new authorization with:

```ts
onClick={() => {
  setPdfPrefillState({ status: 'idle' });
  setIsWizardOpen(true);
}}
```

In current-step cancel branch before closing:

```ts
setPdfPrefillState({ status: 'idle' });
```

- [ ] **Step 5: Add prefill application function**

Add above `handleFilesAdded`:

```ts
const applyPdfPrefillFromFiles = async (files: File[]) => {
  const pdfFile = files.find((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!pdfFile) {
    return;
  }

  setPdfPrefillState({ status: 'extracting', fileName: pdfFile.name });

  try {
    const text = await extractPdfText(pdfFile);
    const prefill = parseAuthorizationPdfText(text);
    if (
      !prefill.authorizationNumber &&
      !prefill.startDate &&
      !prefill.endDate &&
      !prefill.memberId &&
      !prefill.diagnosisCode &&
      prefill.services.length === 0
    ) {
      setPdfPrefillState({ status: 'no_text', fileName: pdfFile.name });
      return;
    }

    let appliedFields: string[] = [];
    let skippedServiceCodes: string[] = [];
    setWizardData((prev) => {
      const result = mergeAuthorizationPdfPrefill(prev, prefill, serviceCatalog);
      appliedFields = result.appliedFields;
      skippedServiceCodes = result.skippedServiceCodes;
      return result.data;
    });

    setPdfPrefillState({ status: 'applied', appliedFields, skippedServiceCodes });
  } catch (error) {
    const message =
      error instanceof PdfTextExtractionError || error instanceof Error
        ? error.message
        : 'PDF text extraction failed.';
    setPdfPrefillState({ status: 'failed', fileName: pdfFile.name, message });
  }
};
```

- [ ] **Step 6: Trigger extraction after accepted files are stored**

At the end of `handleFilesAdded`, after `setWizardData`:

```ts
void applyPdfPrefillFromFiles(acceptedFiles);
```

- [ ] **Step 7: Render status banner in Step 4**

Add below the upload drop zone:

```tsx
{pdfPrefillState.status !== 'idle' && (
  <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
    {pdfPrefillState.status === 'extracting' && (
      <p>Reading {pdfPrefillState.fileName} for authorization prefill...</p>
    )}
    {pdfPrefillState.status === 'applied' && (
      <div>
        <p className="font-medium">PDF prefill applied. Review extracted values before submitting.</p>
        <p className="text-xs">
          Applied fields: {pdfPrefillState.appliedFields.length > 0 ? pdfPrefillState.appliedFields.join(', ') : 'none'}
        </p>
        {pdfPrefillState.skippedServiceCodes.length > 0 && (
          <p className="text-xs">
            Skipped service codes not in catalog: {pdfPrefillState.skippedServiceCodes.join(', ')}
          </p>
        )}
      </div>
    )}
    {pdfPrefillState.status === 'no_text' && (
      <p>No embedded authorization text was found in {pdfPrefillState.fileName}. Enter the notice fields manually.</p>
    )}
    {pdfPrefillState.status === 'failed' && (
      <p>
        Could not prefill from {pdfPrefillState.fileName}: {pdfPrefillState.message} Enter the notice fields manually.
      </p>
    )}
  </div>
)}
```

- [ ] **Step 8: Run component tests**

Run:

```powershell
npm test -- src/components/__tests__/PreAuthTab.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit wizard integration**

Run:

```powershell
git add src/components/ClientDetails/PreAuthTab.tsx src/components/__tests__/PreAuthTab.test.tsx
git commit -m "feat: add WIN-179 authorization PDF prefill to wizard"
```

---

### Task 7: Focused Verification

**Files:**
- No code edits expected.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- src/lib/authorizations/__tests__/pdfPrefill.test.ts src/components/__tests__/PreAuthTab.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run policy checks**

Run:

```powershell
npm run ci:check-focused
```

Expected: PASS. Record any local-only skips separately.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run CI tests**

Run:

```powershell
npm run test:ci
```

Expected: PASS.

- [ ] **Step 6: Run tenant safety**

Run:

```powershell
npm run validate:tenant
```

Expected: PASS.

- [ ] **Step 7: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 8: Run local verification bundle if feasible**

Run:

```powershell
npm run verify:local
```

Expected: PASS or explicitly blocked with reason. If it fails on unrelated broad harness issues, keep the focused verification evidence and report the failing command and first actionable failure.

---

### Task 8: Verify-Change, Review, PR Hygiene, And PR

**Files:**
- No code edits expected unless review finds a required fix.

- [ ] **Step 1: Produce verify-change card**

Use `.agents/skills/verify-change/SKILL.md` and report:

- Classification: `high-risk human-reviewed`
- Lane: `critical`
- Change type: UI/component/page, tenant-scoped authorization document handling
- Required checks: exact command list from Task 7
- Executed checks: command results
- Blocked checks: command plus reason, or `none`
- Result: `pass`, `pass-with-blocked-checks`, or `fail`
- Residual risk: embedded-text PDFs only; scanned PDFs require separately routed OCR

- [ ] **Step 2: Run reviewer pass**

Reviewer focus:

- no raw extracted PDF text is logged, stored, submitted, or committed
- no route guard or role boundary regression
- no schema/RLS/RPC/storage-policy drift
- no admin-entered value overwrite
- no unsupported service code saved

- [ ] **Step 3: Run pr-hygiene**

Use `.agents/skills/pr-hygiene/SKILL.md`.

Expected:

- `pr-ready`: yes only if verification and reviewer pass
- `linear-ready`: yes for `WIN-179`
- `single-purpose`: yes
- `protected-path drift`: none beyond classified critical behavior

- [ ] **Step 4: Push branch and open PR**

Run:

```powershell
git status --short --branch
git push -u origin codex/win-179-auth-pdf-prefill
gh pr create --draft --title "WIN-179 Add authorization PDF extraction-assisted prefill" --body "## Summary
- add browser-side embedded PDF text extraction for the admin authorization upload wizard
- parse authorization notice fields into conservative prefill candidates
- require admin review and preserve the existing authorization save path

## Verification
- npm test -- src/lib/authorizations/__tests__/pdfPrefill.test.ts src/components/__tests__/PreAuthTab.test.tsx
- npm run ci:check-focused
- npm run lint
- npm run typecheck
- npm run test:ci
- npm run validate:tenant
- npm run build
- npm run verify:local

## Risk
- critical-lane change because uploaded authorization documents influence tenant-scoped authorization writes
- no OCR, AI extraction, server/API changes, schema changes, or raw extracted text persistence"
```

Expected: draft PR created for human review. Do not merge autonomously without live branch protection allowing it and required human review being satisfied.
