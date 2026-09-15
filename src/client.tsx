// dsh-bash-terminal-ts client plugin: a "Default terminal" preference row in the
// Web UI General settings. The user picks powershell / gitbash / msys2 / wsl;
// the host shell tool obeys that choice (the model cannot change it).
//
// The option list below must stay in lockstep with SHELLS in ./index.ts: every
// id gets an <option> here and a `shell.<id>` entry in both dictionaries. The
// shipped bundle cannot import the host module (it pulls node: builtins), so
// test/client.ts asserts the bundle covers every host shell id instead.

import { defineStore } from "@deepseek-ai/dsh-client-store";

const SETTINGS_NS = "settings.bash-terminal";
const SETTINGS_NAMESPACE = "bash-terminal";

const zh: Record<string, string> = {
  "shell.title": "默认终端",
  "shell.description": "shell 工具执行命令时使用的终端（由你决定，AI 无法更改）",
  "shell.powershell": "PowerShell",
  "shell.gitbash": "Git Bash",
  "shell.msys2": "MSYS2",
  "shell.wsl": "WSL"
};
const en: Record<string, string> = {
  "shell.title": "Default terminal",
  "shell.description": "Terminal used by the shell tool (you control this; the AI cannot change it)",
  "shell.powershell": "PowerShell",
  "shell.gitbash": "Git Bash",
  "shell.msys2": "MSYS2",
  "shell.wsl": "WSL"
};

export const inject = ["slots", "locale", "settingsScope"];

/** Row state snapshot served through the settings store. */
interface RowState {
  shell: string;
  revision: number;
  writable: boolean;
}

interface ShellPreferenceRowProps {
  t: (key: string) => string;
  useStore: <S>(selector: (state: RowState) => S) => S;
  setShell: (id: string) => void;
}

function ShellPreferenceRow({ t, useStore, setShell }: ShellPreferenceRowProps) {
  const shell = useStore((s) => s.shell);
  const writable = useStore((s) => s.writable);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 0"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: "22px", color: "var(--dsw-alias-label-primary, inherit)" }}>
          {t("shell.title")}
        </div>
        <div style={{ fontSize: 12, lineHeight: "18px", opacity: 0.65 }}>{t("shell.description")}</div>
      </div>
      <select
        value={shell}
        disabled={!writable}
        onChange={(e) => setShell(e.target.value)}
        style={{
          fontSize: 14,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--dsw-alias-line-strong, #ccc)",
          background: "var(--dsw-alias-bg-layer-2, #fff)",
          color: "var(--dsw-alias-label-primary, inherit)",
          outline: "none",
          cursor: writable ? "pointer" : "not-allowed",
          maxWidth: 180
        }}
      >
        <option value="powershell">{t("shell.powershell")}</option>
        <option value="gitbash">{t("shell.gitbash")}</option>
        <option value="msys2">{t("shell.msys2")}</option>
        <option value="wsl">{t("shell.wsl")}</option>
      </select>
    </div>
  );
}

interface SettingsSnapshot {
  status: string;
  value?: { defaultShell?: string };
  revision: number;
  writable: boolean;
}

interface SettingsScopeBinding {
  getSnapshot(): SettingsSnapshot;
  subscribe(fn: () => void): () => void;
  set(field: string, value: string): void;
  unset(): void;
}

interface ClientContext {
  effect(fn: () => unknown, name?: string): unknown;
  locale: { register(ns: string, dicts: Record<string, Record<string, string>>): unknown };
  settingsScope: { bind(options: { namespace: string }): SettingsScopeBinding };
  slots: {
    inject(slot: string, fn: () => unknown, name?: string): void;
    register(options: Record<string, unknown>, Component: unknown): Record<string, unknown>;
  };
}

interface RowStoreActions {
  sync(shell?: string, revision?: number, writable?: boolean): void;
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "bash-terminal: settings dictionaries");
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
  const store = defineStore<RowState, { sync: (draft: RowState, shell?: string, revision?: number, writable?: boolean) => void }>({
    init: (): RowState => ({ shell: "powershell", revision: -1, writable: false }),
    actions: {
      sync: (d, shell, revision, writable) => {
        if (revision !== undefined && revision <= d.revision) return;
        if (shell !== undefined) d.shell = shell;
        if (revision !== undefined) d.revision = revision;
        if (writable !== undefined) d.writable = writable;
      }
    }
  });
  // defineStore() yields a { spec, create } factory; slots.register creates
  // the live store, so we bind the actions in the inject callback and push
  // the initial snapshot there too (mirrors the theme row pattern).
  let bound: RowStoreActions | undefined;
  const push = (snap: SettingsSnapshot): void => {
    bound?.sync(snap.value?.defaultShell, snap.revision, snap.writable);
  };
  ctx.slots.inject(
    "settings.general.item",
    () =>
      ctx.slots.register(
        {
          name: "settings.general.item",
          id: "bash-terminal-shell",
          order: 20,
          store,
          locale: SETTINGS_NS,
          inject: (actions: unknown) => {
            bound = actions as RowStoreActions;
            push(scope.getSnapshot());
            return { setShell: (value: string) => void scope.set("defaultShell", value) };
          }
        },
        ShellPreferenceRow
      ),
    "bash-terminal: settings row"
  );
  ctx.effect(() => scope.subscribe(() => push(scope.getSnapshot())), "bash-terminal: settings watch");
}
