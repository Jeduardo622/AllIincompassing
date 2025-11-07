if (typeof globalThis.BroadcastChannel === 'undefined') {
  class PolyfillBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(name: string) {
      this.name = name;
    }

    postMessage(_message: unknown) {}

    close() {}

    addEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}

    removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}
  }

  // @ts-expect-error assigning shim for test environment
  globalThis.BroadcastChannel = PolyfillBroadcastChannel;
}
