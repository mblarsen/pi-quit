import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@mariozechner/pi-coding-agent";
import {
  isKeyRelease,
  truncateToWidth,
  type EditorTheme,
  type TUI,
  visibleWidth,
} from "@mariozechner/pi-tui";

const DOUBLE_PRESS_WINDOW_MS = 500;

function formatKey(key: string | undefined): string {
  if (!key) return "that key";

  return key
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Ctrl";
      if (lower === "alt") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "cmd" || lower === "meta") return "Cmd";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

class QuitAwareEditor extends CustomEditor {
  private readonly keybindings: KeybindingsManager;
  private readonly isIdle: () => boolean;
  private readonly shutdown: () => void;
  private pendingQuitUntil = 0;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private hintMessage: string | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    callbacks: {
      isIdle: () => boolean;
      shutdown: () => void;
    },
  ) {
    super(tui, theme, keybindings);
    this.keybindings = keybindings;
    this.isIdle = callbacks.isIdle;
    this.shutdown = callbacks.shutdown;
  }

  private clearHint(resetQuitWindow = true): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
    this.hintMessage = undefined;
    if (resetQuitWindow) this.pendingQuitUntil = 0;
    this.tui.requestRender();
  }

  private showHint(message: string): void {
    this.clearHint(false);
    this.hintMessage = message;
    this.tui.requestRender();
    this.hintTimer = setTimeout(() => {
      this.hintTimer = undefined;
      this.hintMessage = undefined;
      this.pendingQuitUntil = 0;
      this.tui.requestRender();
    }, DOUBLE_PRESS_WINDOW_MS);
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) {
      super.handleInput(data);
      return;
    }

    if (!this.keybindings.matches(data, "app.clear")) {
      this.clearHint();
      super.handleInput(data);
      return;
    }

    const now = Date.now();
    const editorIsEmpty = this.getText().length === 0;

    if (!editorIsEmpty) {
      this.clearHint();
      this.pendingQuitUntil = now + DOUBLE_PRESS_WINDOW_MS;
      this.setText("");
      return;
    }

    if (!this.isIdle()) {
      this.clearHint();
      super.handleInput(data);
      return;
    }

    if (this.pendingQuitUntil > 0 && now <= this.pendingQuitUntil) {
      this.clearHint();
      this.shutdown();
      return;
    }

    this.pendingQuitUntil = now + DOUBLE_PRESS_WINDOW_MS;

    const clearKey = this.keybindings.getKeys("app.clear")[0];
    this.showHint(`${formatKey(clearKey)} again to quit`);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (!this.hintMessage || lines.length === 0) return lines;

    const label = `\x1b[33m\x1b[1m${this.hintMessage}\x1b[22m\x1b[39m`;
    const targetLine = 1;
    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(this.getPaddingX(), maxPadding);
    const rightPadding = " ".repeat(paddingX);

    const line = lines[targetLine]!;
    const lineWithoutRightPadding =
      paddingX > 0 && line.endsWith(rightPadding) ? line.slice(0, -paddingX) : line;

    if (visibleWidth(lineWithoutRightPadding) >= visibleWidth(label)) {
      lines[targetLine] =
        truncateToWidth(lineWithoutRightPadding, width - paddingX - visibleWidth(label), "") +
        label +
        rightPadding;
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      return new QuitAwareEditor(tui, theme, keybindings, {
        isIdle: () => ctx.isIdle(),
        shutdown: () => ctx.shutdown(),
      });
    });
  });
}
