// Ambient declarations for client-side peer modules that the DSH web runtime
// provides through its browser module table (and that tests mock). The package
// is not installed locally, so without this shim `src/client.tsx` cannot be
// type-checked; the shape mirrors the store contract's runtime face.

declare module "@deepseek-ai/dsh-client-runtime/client" {
  /**
   * Create a store declaration. The runtime turns the spec into a live store
   * when the slot system registers it; tests observe the `{ spec, create }`
   * factory face.
   */
  export function defineStore<T>(spec: {
    init: () => T;
    actions: Record<string, (draft: T, ...params: any[]) => void>;
  }): unknown;
}
