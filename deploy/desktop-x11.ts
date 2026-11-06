/**
 * Real X11 screenshots and mouse/keyboard actions for the experimental local
 * Desktop Provider. This intentionally does not provide a remote screen feed.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ComputerAction, ComputerObservation } from "@rakazo/adapter-kit";
import { computerObservation } from "./computer-support.js";

const execFileAsync = promisify(execFile);
const env = () => ({ ...process.env, DISPLAY: process.env.DISPLAY || ":99" });

async function xcmd(binary: string, args: string[], ms = 10000): Promise<string> {
  const { stdout } = await execFileAsync(binary, args, {
    env: env(), timeout: ms, maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function pasteboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("xclip", ["-selection", "clipboard"], {
      env: env(), stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (data: string) => { stderr += data.slice(0, 1000); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`xclip: ${stderr || code}`)));
    if (!child.stdin) { reject(new Error("No xclip stdin")); return; }
    child.stdin.end(text);
  });
}

function coord(x: number): string {
  if (!Number.isFinite(x)) throw new Error("Invalid coordinate");
  return String(Math.max(0, Math.min(8192, Math.round(x))));
}
function keyboard(value: string, modifiers: string[] = []): string {
  const names: Record<string, string> = {
    CTRL: "ctrl", CONTROL: "ctrl", ALT: "alt", SHIFT: "shift", META: "super",
    CMD: "super", SUPER: "super", ENTER: "Return", RETURN: "Return",
    ESC: "Escape", ESCAPE: "Escape", BACKSPACE: "BackSpace", DELETE: "Delete",
    TAB: "Tab", SPACE: "space", ARROWUP: "Up", ARROWDOWN: "Down",
    ARROWLEFT: "Left", ARROWRIGHT: "Right", PAGEUP: "Prior", PAGEDOWN: "Next",
  };
  return [...modifiers, ...value.split("+")].map(k => {
    const mapped = names[k.toUpperCase()] || k;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(mapped)) throw new Error("Invalid keyboard key");
    return mapped;
  }).join("+");
}

export async function observeX11(): Promise<ComputerObservation> {
  const file = path.join(tmpdir(), `rakazo-screen-${randomUUID()}.png`);
  try {
    await xcmd("scrot", ["-z", file]);
    const image = new Uint8Array(await readFile(file));
    const display = await xcmd("xdpyinfo", []);
    const dimensions = display.match(/dimensions:\s*(\d+)x(\d+)\s+pixels/);
    if (!dimensions) throw new Error("Could not determine virtual screen size");
    return computerObservation(image, {
      mimeType: "image/png", width: Number(dimensions[1]), height: Number(dimensions[2]),
    });
  } finally {
    await rm(file, { force: true });
  }
}

export async function actX11(action: ComputerAction): Promise<void> {
  switch (action.kind) {
    case "pointer": {
      await xcmd("xdotool", ["mousemove", "--sync", coord(action.x), coord(action.y)]);
      const button = action.button === "right" ? "3" : "1";
      if (action.type === "click") await xcmd("xdotool", ["click", button]);
      else if (action.type === "down") await xcmd("xdotool", ["mousedown", button]);
      else if (action.type === "up") await xcmd("xdotool", ["mouseup", button]);
      break;
    }
    case "key":
      await xcmd("xdotool", ["key", "--clearmodifiers", keyboard(action.key, action.modifiers)]);
      break;
    case "clipboard":
      await pasteboard(action.text);
      await xcmd("xdotool", ["key", "--clearmodifiers", "ctrl+v"]);
      break;
    case "scroll": {
      if (action.x !== undefined && action.y !== undefined) {
        await xcmd("xdotool", ["mousemove", "--sync", coord(action.x), coord(action.y)]);
      }
      const button = ({ up: "4", down: "5", left: "6", right: "7" } as const)[action.direction];
      const amount = Math.max(1, Math.min(30, Math.round(action.amount ?? 3)));
      await xcmd("xdotool", ["click", "--repeat", String(amount), "--delay", "50", button]);
      break;
    }
    case "wait":
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(10000, action.ms))));
      break;
    case "open":
      await xcmd("xdotool", ["key", "--clearmodifiers", "ctrl+l"]);
      await pasteboard(action.path);
      await xcmd("xdotool", ["key", "--clearmodifiers", "ctrl+v"]);
      await xcmd("xdotool", ["key", "Return"]);
      break;
    case "launch":
      if (!/^(chrome|chromium|google-chrome(-stable)?)$/i.test(action.application)) {
        throw new Error("Only Chrome launch is supported by this X11 provider");
      }
      // Chrome is started during container boot. Bring its existing window forward.
      await xcmd("xdotool", ["search", "--onlyvisible", "--class", "chrome", "windowactivate", "--sync"])
        .catch(() => undefined);
      if (action.uri) await actX11({ kind: "open", path: action.uri });
      break;
    case "focus":
      await xcmd("xdotool", ["search", "--onlyvisible", "--class", "chrome", "windowactivate", "--sync"])
        .catch(() => undefined);
      if (action.uri) await actX11({ kind: "open", path: action.uri });
      break;
    default: {
      const neverAction: never = action;
      throw new Error(`Unsupported X11 action: ${String(neverAction)}`);
    }
  }
}
