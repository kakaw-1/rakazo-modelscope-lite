/**
 * Fail-closed source patch: add X11 screenshots and computer actions to Rakazo's
 * development-only DesktopSandboxProvider. If upstream changes, fail the build.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const target = resolve(root, 'packages/adapters/src/desktop-sandbox.ts');
let source = readFileSync(target, 'utf8');

function replaceOnce(oldText, newText, reason) {
  const occurrences = source.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Desktop Provider patch failed (${reason}): expected 1 occurrence, found ${occurrences}; pin a compatible upstream Rakazo commit.`);
  }
  source = source.replace(oldText, newText);
}

replaceOnce(
  'import { removeOwnedWorkspaceChildren } from "./desktop-workspace-cleanup.js";',
  'import { removeOwnedWorkspaceChildren } from "./desktop-workspace-cleanup.js";\nimport { observeX11, actX11 } from "./desktop-x11.js";',
  'X11 module import',
);
replaceOnce('      graphical: false,', '      graphical: process.env.RAKAZO_X11 === "1",', 'graphics capability');
replaceOnce(
  '    if (box) applyPlaceholderAction(box, input);',
  '    if (!box) return;\n    if (process.env.RAKAZO_X11 === "1") await actX11(input);\n    else applyPlaceholderAction(box, input);',
  'sendInput',
);
replaceOnce(
  '    return placeholderObservation(this.requiredBox(computer).screen);',
  '    this.requiredBox(computer);\n    if (process.env.RAKAZO_X11 === "1") return observeX11();\n    return placeholderObservation(this.requiredBox(computer).screen);',
  'observe',
);
replaceOnce(
  '    for (const action of actions) applyPlaceholderAction(box, action);',
  '    for (const action of actions) {\n      if (process.env.RAKAZO_X11 === "1") await actX11(action);\n      else applyPlaceholderAction(box, action);\n    }',
  'act',
);
// Convert Desktop Provider's placeholder ScreenSession to the actual local
// read-only noVNC gateway. Rakazo's existing authenticated /novnc proxy
// seals and re-hosts this URL for its web/Electron Computer pane.
// Match the entire original method, fail closed if the upstream contract changes.
const screenMethod = /  async connectScreen\(\s*computer: ComputerRef,\s*_request: ScreenRequest,\s*_context: AdapterContext,\s*\): Promise<ScreenSession> \{\s*return \{\s*url: `desktop:\/\/screen\/\$\{computer\.id\}`,\s*mimeType: "text\/plain",\s*close: async \(\) => undefined,\s*\};\s*\}/g;
const screenMatches = [...source.matchAll(screenMethod)];
if (screenMatches.length !== 1) {
  throw new Error(`Desktop screen patch failed: expected one placeholder connectScreen(), found ${screenMatches.length}; pin a compatible Rakazo commit.`);
}
source = source.replace(screenMethod, `  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    this.requiredBox(computer);
    if (process.env.RAKAZO_X11 === "1") {
      // The local x11vnc endpoint is also started with -viewonly.
      // Human takeover needs its own authenticated control channel; refuse it.
      if (_request.interactive) {
        throw new Error("This Desktop Provider screen is view-only; interactive takeover is disabled");
      }
      return {
        url: "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale&view_only=true&path=websockify",
        mimeType: "text/html",
        close: async () => undefined,
      };
    }
    return {
      url: \`desktop://screen/\${computer.id}\`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }`);

writeFileSync(target, source);
copyFileSync(
  resolve(root, 'infra/modelscope-single/desktop-x11.ts'),
  resolve(root, 'packages/adapters/src/desktop-x11.ts'),
);
console.log('Enabled experimental X11 observe/act plus view-only noVNC connectScreen.');
