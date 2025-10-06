import { describe, it } from 'vitest';

type SuiteSelectorOptions = {
  run: boolean;
  reason?: string;
};

type TestSelectorOptions = SuiteSelectorOptions;

type SuiteFn = typeof describe;
type TestFn = typeof it;

const appendReason = (title: string, reason?: string) => {
  if (!reason) {
    return title;
  }

  return `${title} (skipped: ${reason})`;
};

const cloneSuite = (source: SuiteFn, target: SuiteFn) => {
  Object.assign(target, source);
};

const cloneTest = (source: TestFn, target: TestFn) => {
  Object.assign(target, source);
};

export const selectSuite = ({ run, reason }: SuiteSelectorOptions): SuiteFn => {
  if (run) {
    return describe;
  }

  const skipped: SuiteFn = ((title, ...rest) => {
    return describe.skip(appendReason(title, reason), ...rest);
  }) as SuiteFn;

  cloneSuite(describe, skipped);

  return skipped;
};

export const selectTest = ({ run, reason }: TestSelectorOptions): TestFn => {
  if (run) {
    return it;
  }

  const skipped: TestFn = ((title, ...rest) => {
    return it.skip(appendReason(title, reason), ...rest);
  }) as TestFn;

  cloneTest(it, skipped);

  return skipped;
};
