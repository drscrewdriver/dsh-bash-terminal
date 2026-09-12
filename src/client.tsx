// dsh-bash-terminal client plugin: a "Default terminal" preference row in the
// Web UI General settings, mirroring the shipped EnterBehaviorRow grammar
// (row layout, capsule selector with chevron, --dsw-* tokens).
//
// The row offers one entry per host shell id — powershell / gitbash / msys2 /
// wsl — in the same order as SHELLS in ./index.ts.
//
// DSH >= 0.1.5: the browser module table (PLATFORM_MODULES) seeds react,
// @deepseek-ai/cordis, @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
// @deepseek-ai/dsh-client-ui-primitives and @deepseek-ai/dsh-client-ui-dockkit by
// exact bare specifier. The old dsh-client-runtime name is gone from that table
// (and so is its /client subpath), so this bundle requests dsh-client-store.

import { useState } from "react";
import { defineStore } from "@deepseek-ai/dsh-client-store";
import { IconChevronDownOutline14, Menu } from "@deepseek-ai/dsh-client-ui-primitives";

const SETTINGS_NS = "settings.bash-terminal";
const SETTINGS_NAMESPACE = "bash-terminal";
const SHELLS = ["powershell", "gitbash", "msys2", "wsl"] as const;

type ShellOption = (typeof SHELLS)[number];

// Injected once when the browser loads the bundle (node tests guard on document).
const ROW_CSS =
  ".btRow{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}" +
  ".btRowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}" +
  ".btTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}" +
  ".btDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}" +
  ".btSelector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}" +
  ".btSelector:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
  ".btChevron{flex:none}";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"bash-terminal-row\"]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-bash-terminal";
  tag.dataset.pluginCss = "bash-terminal-row";
  tag.textContent = ROW_CSS;
  document.head.appendChild(tag);
}

const zh: Record<string, string> = {
  "shell.title": "默认终端",
  "shell.description": "shell 工具执行命令时使用的终端",
  "shell.powershell": "PowerShell",
  "shell.gitbash": "Git Bash",
  "shell.msys2": "MSYS2",
  "shell.wsl": "WSL"
};
const en: Record<string, string> = {
  "shell.title": "Default terminal",
  "shell.description": "Terminal used by the shell tool",
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
  const [open, setOpen] = useState(false);
  const items = SHELLS.map((id) => ({ id, label: t("shell." + id) }));
  return (
    <div className="btRow">
      <div className="btRowText">
        <div className="btTitle">{t("shell.title")}</div>
        <div className="btDesc">{t("shell.description")}</div>
      </div>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        selectedId={shell}
        onSelect={(id) => {
          setOpen(false);
          setShell(id);
        }}
        align="end"
        portal
        anchor={
          <button
            type="button"
            className="btSelector"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={!writable}
            onClick={() => setOpen(!open)}
            style={!writable ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            {t("shell." + shell)}
            <IconChevronDownOutline14 className="btChevron" />
          </button>
        }
      />
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

interface RowStore {
  actions: RowStoreActions;
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
