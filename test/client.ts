// Client plugin logic test: load dist/client.js under a mocked __ModuleLoader__
// and exercise apply(ctx) with mocked slots/locale/settingsScope services.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const profileRequire = createRequire(join(os.homedir(), ".dsh", "profiles", "web", "package.json"));

// --- mock defineStore (shape mirrors dsh-client-store: { spec, create }) ---
interface MockStore {
  actions: Record<string, (...params: unknown[]) => void>;
  getSnapshot: () => Record<string, unknown>;
  subscribe: (fn: () => void) => () => boolean;
}
type MockDefineStore = (decl: {
  init: () => Record<string, unknown>;
  actions: Record<string, (state: Record<string, unknown>, ...params: unknown[]) => void>;
}) => unknown;

const mockDefineStore: MockDefineStore = (decl) => ({
  spec: decl,
  create: (): MockStore => {
    const state = decl.init();
    const listeners = new Set<() => void>();
    const actions: Record<string, (...params: unknown[]) => void> = {};
    for (const key of Object.keys(decl.actions)) {
      actions[key] = (...params: unknown[]) => { decl.actions[key](state, ...params); for (const f of listeners) f(); };
    }
    return {
      actions,
      getSnapshot: () => state,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
    };
  }
});

// --- mocked services ---
interface ScopeState { status: string; value: { defaultShell?: string }; revision: number; writable: boolean }
interface ClientTestContext {
  slots: {
    inject(slot: string, fn: () => unknown): void;
    register(options: Record<string, unknown>, Component: unknown): Record<string, unknown>;
  };
  locale: { register(ns: string, dicts: Record<string, Record<string, string>>): unknown };
  settingsScope: {
    bind(): {
      getSnapshot(): ScopeState;
      subscribe(): () => void;
      set(field: string, value: string): void;
      unset(): void;
    };
  };
  effect(fn: () => unknown): unknown;
}
interface ExportedClient {
  inject: string[];
  apply: (ctx: ClientTestContext) => void;
}
let scopeState: ScopeState = { status: "ready", value: { defaultShell: "gitbash" }, revision: 3, writable: true };
const setCalls: { field: string; value: string }[] = [];
const localeRegisters: { ns: string; dicts: Record<string, Record<string, string>> }[] = [];
const slotRegistrations: { slot: string; fn: () => unknown }[] = [];
const ctx: ClientTestContext = {
  slots: {
    inject: (slot, fn) => { slotRegistrations.push({ slot, fn }); },
    register: (options, Component) => ({ ...options, Component })
  },
  locale: { register: (ns, dicts) => { localeRegisters.push({ ns, dicts }); } },
  settingsScope: {
    bind: () => ({
      getSnapshot: () => scopeState,
      subscribe: () => () => {},
      set: (field, value) => { setCalls.push({ field, value }); },
      unset: () => {}
    })
  },
  effect: (fn) => { fn(); }
};

// --- load the built client bundle under a fake module loader ---
const bundle = readFileSync(new URL("../dist/client.js", import.meta.url), "utf8");
assert.ok(bundle.includes("window.__ModuleLoader__.load"), "bundle wrapped");
let exported: ExportedClient | undefined;
const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
globalWithWindow.window = {
  __ModuleLoader__: {
    load: ({ id, factory }: { id: string; factory: (require: (name: string) => unknown) => unknown }) => {
      assert.strictEqual(id, "dsh-bash-terminal");
      exported = factory((name) => {
        if (name === "@deepseek-ai/dsh-client-store") return { defineStore: mockDefineStore };
        if (name === "react/jsx-runtime" || name === "react") return profileRequire(name);
        throw new Error("unexpected require: " + name);
      }) as ExportedClient;
    }
  }
};
new Function(bundle)();
assert.ok(exported, "client module exports");
assert.deepStrictEqual(exported!.inject, ["slots", "locale", "settingsScope"]);
assert.strictEqual(typeof exported!.apply, "function");

// --- run apply ---
exported!.apply(ctx);

// locale dictionaries registered
assert.strictEqual(localeRegisters.length, 1);
assert.strictEqual(localeRegisters[0].ns, "settings.bash-terminal");
assert.ok(localeRegisters[0].dicts.zh["shell.title"]);
assert.ok(localeRegisters[0].dicts.en["shell.title"]);

// Drift guard: the Web UI must offer exactly the shells the host supports.
// src/client.tsx cannot import the host module (node: builtins), so the contract
// is asserted here against the shipped bundle instead.
const hostShells = ["powershell", "gitbash", "msys2", "wsl"];
const enDict = localeRegisters[0].dicts.en!;
const zhDict = localeRegisters[0].dicts.zh!;
for (const id of hostShells) {
  assert.ok(enDict[`shell.${id}`], `en dictionary missing shell.${id}`);
  assert.ok(zhDict[`shell.${id}`], `zh dictionary missing shell.${id}`);
  assert.ok(
    new RegExp(`value:\\s*"${id}"`).test(bundle),
    `client bundle renders no <option> for shell "${id}"`
  );
}
assert.strictEqual(
  Object.keys(enDict).filter((k) => k.startsWith("shell.")).length,
  hostShells.length + 2,
  "en dictionary has an unexpected number of shell.* keys"
);

// settings row registered into the General item slot
assert.strictEqual(slotRegistrations.length, 1);
assert.strictEqual(slotRegistrations[0].slot, "settings.general.item");
const regObj = slotRegistrations[0].fn() as Record<string, unknown>;
const reg = regObj;
const Component = regObj.Component;
assert.strictEqual(reg.name, "settings.general.item");
assert.strictEqual(reg.id, "bash-terminal-shell");
assert.strictEqual(typeof reg.order, "number");
assert.strictEqual(reg.locale, "settings.bash-terminal");
assert.ok(reg.store && typeof (reg.store as unknown as { create: unknown }).create === "function", "store factory passed to register");
assert.strictEqual(typeof Component, "function", "row component passed");

// inject callback binds actions, pushes initial snapshot, exposes setShell
let lastSync: unknown[] = [];
interface InjectedFace { setShell: (value: string) => void }
const injected = (reg.inject as (actions: unknown) => InjectedFace)({ sync: (...args: unknown[]) => { lastSync = args; } });
assert.ok(injected && typeof injected.setShell === "function");
assert.deepStrictEqual(lastSync, ["gitbash", 3, true], "initial snapshot pushed (user default gitbash)");

// setShell writes through to the settings scope
injected.setShell("wsl");
assert.deepStrictEqual(setCalls, [{ field: "defaultShell", value: "wsl" }]);

// row component renders a select reflecting the store value
const renderState = { shell: "wsl", revision: 3, writable: true };
const selectors: unknown[] = [];
const fakeUseStore = (sel: (s: typeof renderState) => unknown) => { selectors.push(sel(renderState)); return selectors[selectors.length - 1]; };
const t = (k: string) => ({ "shell.title": "默认终端", "shell.powershell": "PowerShell", "shell.gitbash": "Git Bash", "shell.wsl": "WSL" }[k] ?? k);
const html = (Component as (props: { t: typeof t; useStore: typeof fakeUseStore; setShell: InjectedFace["setShell"] }) => unknown)({ t, useStore: fakeUseStore, setShell: injected.setShell });
assert.ok(html && typeof html === "object", "component rendered");
assert.deepStrictEqual(selectors, ["wsl", true], "component reads shell + writable from store");

// settings change -> bound actions sync again (subscribe callback fires push)
scopeState = { status: "ready", value: { defaultShell: "powershell" }, revision: 4, writable: true };
// re-invoke the stored subscribe callback path: the bundle registered a
// subscription when apply ran; we captured nothing, so emulate by calling
// the register inject again with a fresh bound (fresh push uses new state).
const injected2 = (reg.inject as (actions: unknown) => InjectedFace)({ sync: (...args: unknown[]) => { lastSync = args; } });
assert.deepStrictEqual(lastSync, ["powershell", 4, true], "re-push after settings change");
void injected2;

console.log("CLIENT LOGIC TESTS PASSED");
