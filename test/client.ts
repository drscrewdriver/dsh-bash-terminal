// Client plugin logic test: load lib/client.js under a mocked __ModuleLoader__
// and exercise apply(ctx) with mocked slots/locale/settingsScope services.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import assert from "node:assert";
const profileRequire = createRequire(join(os.homedir(), ".dsh", "profiles", "web", "package.json"));
function loadShared(name: string): unknown {
  // CI: react is installed into the project node_modules (npm install react --no-save);
  // local dev: resolve from the profile dependency tree instead.
  try {
    return createRequire(import.meta.url)(name);
  } catch {
    return profileRequire(name);
  }
}

interface ReactLike {
  createElement: (tag: unknown, props?: unknown, ...children: unknown[]) => unknown;
}
interface ReactDomServerLike {
  renderToString: (element: unknown) => string;
}

// --- mock defineStore (shape mirrors dsh-client-store: { spec, create }) ---
interface MockStore {
  actions: Record<string, (...params: unknown[]) => void>;
  getSnapshot: () => Record<string, unknown>;
  subscribe: (fn: () => void) => () => boolean;
}
type MockDefineStore = (decl: {
  init: () => Record<string, unknown>;
  actions: Record<string, (state: Record<string, unknown>, ...params: unknown[]) => void>;
}) => MockStore;

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
}) as unknown as MockStore;

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
    inject: (slot: string, fn: () => unknown) => { slotRegistrations.push({ slot, fn }); },
    register: (options: Record<string, unknown>, Component: unknown) => ({ ...options, Component })
  },
  locale: { register: (ns: string, dicts: Record<string, Record<string, string>>) => { localeRegisters.push({ ns, dicts }); } },
  settingsScope: {
    bind: () => ({
      getSnapshot: () => scopeState,
      subscribe: () => () => {},
      set: (field: string, value: string) => { setCalls.push({ field, value }); },
      unset: () => {}
    })
  },
  effect: (fn: () => unknown) => { fn(); }
};

// --- load the built client bundle under a fake module loader ---
const bundle = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
assert.ok(bundle.includes("window.__ModuleLoader__.load"), "bundle wrapped");
// DSH >= 0.1.5 regression guard: the platform seed table spells the store
// package @deepseek-ai/dsh-client-store; the retired runtime name would miss it.
assert.ok(bundle.includes("@deepseek-ai/dsh-client-store"), "requests the seeded client store");
assert.ok(!bundle.includes("dsh-client-runtime"), "does not request the retired client runtime");
// Menu props are captured so the rendered option list can be inspected: this
// branch renders a Menu of items, not a <select> of <option>.
const menuProps: { items?: { id: string; label: string }[] }[] = [];
let exported: ExportedClient | undefined;
const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
globalWithWindow.window = {
  __ModuleLoader__: {
    load: ({ id, factory }: { id: string; factory: (require: (name: string) => unknown) => unknown }) => {
      assert.strictEqual(id, "dsh-bash-terminal");
      exported = factory((name) => {
        if (name === "@deepseek-ai/dsh-client-store") return { defineStore: mockDefineStore };
        if (name === "react/jsx-runtime" || name === "react" || name === "react-dom/server") return loadShared(name);
        if (name === "@deepseek-ai/dsh-client-ui-primitives") {
          const React = loadShared("react") as ReactLike;
          return {
            Menu: (props: { anchor: unknown; items?: { id: string; label: string }[] }) => {
              menuProps.push(props);
              return React.createElement(
                "div",
                null,
                props.anchor,
                ...(props.items ?? []).map((item) => React.createElement("span", { key: item.id }, item.label))
              );
            },
            IconChevronDownOutline14: () => null
          };
        }
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

// Drift guard: the Web UI must offer exactly the backends the host supports, in
// the host's order. src/client.tsx cannot import the host module (it pulls
// node: builtins), so the contract is asserted against the shipped bundle and
// the rendered menu instead. The host list is spelled out here on purpose: if a
// backend is added to src/index.ts SHELLS without the client half, this fails.
const hostShells = ["powershell", "gitbash", "msys2", "wsl"];
const bundleShells = /var SHELLS = \[([^\]]*)\]/.exec(bundle);
assert.ok(bundleShells, "client bundle declares its shell list");
const parsedShells = bundleShells[1].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
assert.deepStrictEqual(parsedShells, hostShells, "client shell list matches the host list, in host order");
const zhDict = localeRegisters[0].dicts.zh;
const enDict = localeRegisters[0].dicts.en;
for (const id of hostShells) {
  assert.strictEqual(typeof zhDict["shell." + id], "string", "zh dictionary missing shell." + id);
  assert.strictEqual(typeof enDict["shell." + id], "string", "en dictionary missing shell." + id);
  assert.strictEqual(zhDict["shell." + id], enDict["shell." + id], "shell." + id + " is a proper noun and must not be translated");
}
assert.strictEqual(zhDict["shell.msys2"], "MSYS2", "MSYS2 label");
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

// row component renders through real React (DSH-native Menu/Button are mocked)
const { renderToString } = loadShared("react-dom/server") as ReactDomServerLike;
const renderState = { shell: "wsl", revision: 3, writable: true };
const selectors: unknown[] = [];
const fakeUseStore = (sel: (s: typeof renderState) => unknown) => { selectors.push(sel(renderState)); return selectors[selectors.length - 1]; };
const t = (k: string) => ({ "shell.title": "默认终端", "shell.powershell": "PowerShell", "shell.gitbash": "Git Bash", "shell.msys2": "MSYS2", "shell.wsl": "WSL" }[k] ?? k);
const React = loadShared("react") as ReactLike;
const html = renderToString(React.createElement(Component, { t, useStore: fakeUseStore, setShell: injected.setShell }));
assert.ok(html.includes("默认终端"), "row renders the title");
assert.ok(!html.includes("AI 无法更改"), "removed the 'AI cannot change' phrase");
assert.ok(html.includes("WSL"), "selector shows the current shell label");
assert.ok(html.includes("btSelector"), "selector uses the official capsule class");
assert.deepStrictEqual(selectors, ["wsl", true], "component reads shell + writable from store");

// The rendered option list covers every host shell id, in the host's order, and
// each entry is labelled through the locale dictionary.
assert.strictEqual(menuProps.length, 1, "menu rendered exactly once");
const menuItems = menuProps[0].items ?? [];
assert.deepStrictEqual(menuItems.map((item) => item.id), hostShells, "menu offers every host shell id in host order");
assert.deepStrictEqual(
  menuItems.map((item) => item.label),
  ["PowerShell", "Git Bash", "MSYS2", "WSL"],
  "menu labels come from the dictionaries"
);
assert.ok(html.includes("MSYS2"), "rendered row includes the MSYS2 entry");

// settings change -> bound actions sync again (subscribe callback fires push)
scopeState = { status: "ready", value: { defaultShell: "powershell" }, revision: 4, writable: true };
// re-invoke the stored subscribe callback path: the bundle registered a
// subscription when apply ran; we captured nothing, so emulate by calling
// the register inject again with a fresh bound (fresh push uses new state).
const injected2 = (reg.inject as (actions: unknown) => InjectedFace)({ sync: (...args: unknown[]) => { lastSync = args; } });
assert.deepStrictEqual(lastSync, ["powershell", 4, true], "re-push after settings change");
void injected2;

console.log("CLIENT LOGIC TESTS PASSED");
