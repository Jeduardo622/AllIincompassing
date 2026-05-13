import { expect } from "jsr:@std/expect";

import { sanitizePdfText } from "./pdf-text.ts";

Deno.test("sanitizePdfText normalizes unsupported glyphs for PDF rendering", () => {
  const raw =
    "Caregiver goals ● improve transitions — maintain consistency\n“Smart quotes” and ellipsis…";

  expect(sanitizePdfText(raw)).toBe(
    'Caregiver goals - improve transitions - maintain consistency\n"Smart quotes" and ellipsis...',
  );
});

Deno.test("sanitizePdfText preserves supported Latin-1 characters", () => {
  const raw = "José François Åsa Zoë Crème brûlée";

  expect(sanitizePdfText(raw)).toBe(raw);
});
