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
writeFileSync(target, source);
copyFileSync(
  resolve(root, 'infra/modelscope-single/desktop-x11.ts'),
  resolve(root, 'packages/adapters/src/desktop-x11.ts'),
);
console.log('Enabled experimental X11 screenshot and mouse/keyboard Desktop Provider interface.');
