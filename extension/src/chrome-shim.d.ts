// Minimal typings for the Chrome extension APIs used here.
declare const __BROKER_HOSTS__: string[];
declare namespace chrome {
  namespace runtime {
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(cb: (message: unknown, sender: { tab?: { id?: number; url?: string } }, sendResponse: (r: unknown) => void) => boolean | void): void;
    };
  }
  namespace tabs {
    function query(q: { url?: string | string[] }): Promise<{ id?: number; url?: string }[]>;
    function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  }
  namespace alarms {
    function create(name: string, info: { periodInMinutes: number }): void;
    const onAlarm: { addListener(cb: (a: { name: string }) => void): void };
  }
}
