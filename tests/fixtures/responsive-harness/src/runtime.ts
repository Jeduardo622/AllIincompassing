type HarnessRequest = {
  method: string;
  path: string;
};

type BrowserRequest = {
  method: string;
  url: string;
};

export type ResponsiveHarnessRuntime = {
  envSentinel: string | null;
  apiCalls: HarnessRequest[];
  fetchCalls: BrowserRequest[];
  xhrCalls: BrowserRequest[];
  storageReads: number;
  storageWrites: number;
  cookieReads: number;
  cookieWrites: number;
};

declare global {
  interface Window {
    __RESPONSIVE_HARNESS__?: ResponsiveHarnessRuntime;
    __RESPONSIVE_HARNESS_RUNTIME_INSTALLED__?: boolean;
  }
}

const getRuntime = (): ResponsiveHarnessRuntime => {
  if (!window.__RESPONSIVE_HARNESS__) {
    window.__RESPONSIVE_HARNESS__ = {
      envSentinel: null,
      apiCalls: [],
      fetchCalls: [],
      xhrCalls: [],
      storageReads: 0,
      storageWrites: 0,
      cookieReads: 0,
      cookieWrites: 0,
    };
  }

  return window.__RESPONSIVE_HARNESS__;
};

export const recordApiCall = (method: string, path: string) => {
  getRuntime().apiCalls.push({ method: method.toUpperCase(), path });
};

export const installResponsiveHarnessRuntime = (envSentinel: string | null) => {
  const runtime = getRuntime();
  runtime.envSentinel = envSentinel;

  if (window.__RESPONSIVE_HARNESS_RUNTIME_INSTALLED__) {
    return runtime;
  }

  window.__RESPONSIVE_HARNESS_RUNTIME_INSTALLED__ = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    runtime.fetchCalls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    });
    return originalFetch(input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
    runtime.xhrCalls.push({
      method: method.toUpperCase(),
      url: typeof url === "string" ? url : url.toString(),
    });
    return originalOpen.call(this, method, url, ...(rest as [boolean | undefined, string | undefined, string | undefined]));
  };

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  Storage.prototype.getItem = function getItem(key: string) {
    runtime.storageReads += 1;
    return originalGetItem.call(this, key);
  };
  Storage.prototype.setItem = function setItem(key: string, value: string) {
    runtime.storageWrites += 1;
    return originalSetItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function removeItem(key: string) {
    runtime.storageWrites += 1;
    return originalRemoveItem.call(this, key);
  };
  Storage.prototype.clear = function clear() {
    runtime.storageWrites += 1;
    return originalClear.call(this);
  };

  const cookieDescriptor =
    Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
    Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

  if (cookieDescriptor?.set || cookieDescriptor?.get) {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      enumerable: true,
      get() {
        runtime.cookieReads += 1;
        return cookieDescriptor.get?.call(document) ?? "";
      },
      set(value: string) {
        runtime.cookieWrites += 1;
        cookieDescriptor.set?.call(document, value);
      },
    });
  }

  return runtime;
};
