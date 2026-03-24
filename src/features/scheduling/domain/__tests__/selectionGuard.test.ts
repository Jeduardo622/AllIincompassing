import { describe, expect, it } from "vitest";
import { shouldClearMissingSelection } from "../selectionGuard";

describe("selectionGuard", () => {
  const entities = [{ id: "a" }, { id: "b" }];

  it("returns false when no selection is set", () => {
    expect(shouldClearMissingSelection(null, entities)).toBe(false);
  });

  it("returns false when selected id exists", () => {
    expect(shouldClearMissingSelection("a", entities)).toBe(false);
  });

  it("returns true when selected id is missing", () => {
    expect(shouldClearMissingSelection("missing", entities)).toBe(true);
  });

  it("returns true when selected id is set and entity list is empty", () => {
    expect(shouldClearMissingSelection("a", [])).toBe(true);
  });
});
