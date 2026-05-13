import { expect } from "jsr:@std/expect";

import { layoutOverlayText, wrapOverlayText } from "./overlay-layout.ts";
import { isPdfCheckboxNotApplicableValue, resolvePdfCheckboxValue, sanitizePdfText } from "./pdf-text.ts";

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

Deno.test("resolvePdfCheckboxValue preserves explicit unchecked behavior for unsupported glyphs", () => {
  expect(resolvePdfCheckboxValue("☐")).toBe(false);
  expect(resolvePdfCheckboxValue("✗")).toBe(false);
  expect(resolvePdfCheckboxValue("   ")).toBeNull();
});

Deno.test("isPdfCheckboxNotApplicableValue preserves N/A as a distinct checkbox fallback case", () => {
  expect(isPdfCheckboxNotApplicableValue("N/A")).toBe(true);
  expect(isPdfCheckboxNotApplicableValue("not applicable")).toBe(true);
  expect(isPdfCheckboxNotApplicableValue("No")).toBe(false);
});

Deno.test("layoutOverlayText fits text inside the configured field box and flags overflow", () => {
  const font = {
    widthOfTextAtSize: (value: string, size: number) => value.length * size * 0.5,
  };

  const layout = layoutOverlayText(
    {
      placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
      fallback: {
        page: 2,
        x: 64,
        y: 541,
        font_size: 8,
        max_width: 80,
        height: 18,
        line_height: 9,
      },
    },
    "This long complaint must wrap across more than two lines without drawing beyond the box.",
    font,
  );

  expect(layout.lines.length).toBe(2);
  expect(layout.warning?.placeholder_key).toBe("CALOPTIMA_FBA_CHIEF_COMPLAINT");
  expect(layout.warning?.reason).toBe("overflow");
});

Deno.test("wrapOverlayText does not insert spaces into long unbroken tokens", () => {
  const font = {
    widthOfTextAtSize: (value: string, size: number) => value.length * size,
  };
  const rawToken = "CIN1234567890";
  const lines = wrapOverlayText(rawToken, 36, font, 6);

  expect(lines.join("")).toBe(rawToken);
  expect(lines.join(" ")).not.toBe(rawToken);
});
