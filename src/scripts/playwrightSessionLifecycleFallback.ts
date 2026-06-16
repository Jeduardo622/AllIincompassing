export const isAlreadyTerminalLifecycleFallbackResponse = (
  responseStatus: number,
  bodyText: string,
): boolean => {
  if (responseStatus !== 409) {
    return false;
  }

  return /"code"\s*:\s*"ALREADY_TERMINAL"/i.test(bodyText);
};
