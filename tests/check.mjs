import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const fixture = `
import { removeOwnedWorkspaceChildren } from "./desktop-workspace-cleanup.js";
const capabilities = {
      graphical: false,
};
  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    return {
      url: \`desktop://screen/\${computer.id}\`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }
  async sendInput() {
    if (box) applyPlaceholderAction(box, input);
  }
  async observe() {
    return placeholderObservation(this.requiredBox(computer).screen);
  }
  async act() {
    for (const action of actions) applyPlaceholderAction(box, action);
  }
`;
function runFixture(source, shouldPass) {
  const temp = mkdtempSync(join(tmpdir(), 'rakazo-patch-'));
  try {
    const targetDir = join(temp, 'packages/adapters/src');
    const filesDir = join(temp, 'infra/modelscope-single');
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(targetDir, 'desktop-sandbox.ts'), source);
    writeFileSync(join(filesDir, 'desktop-x11.ts'), readFileSync(join(repo, 'deploy/desktop-x11.ts')));
    const result = spawnSync(process.execPath, [join(repo, 'deploy/patch-desktop.mjs')], {
      cwd: temp, encoding: 'utf8'
    });
    if (shouldPass) {
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(join(targetDir, 'desktop-sandbox.ts'), 'utf8');
      assert.match(output, /RAKAZO_X11/);
      assert.match(output, /http:\/\/127\.0\.0\.1:6080\/vnc\.html/);
      assert.match(output, /_request\.interactive/);
      assert.match(output, /mimeType: "text\/html"/);
      assert.ok(existsSync(join(targetDir, 'desktop-x11.ts')));
    } else {
      assert.notEqual(result.status, 0, 'changed upstream contract should fail closed');
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
runFixture(fixture, true);
runFixture(fixture.replace('mimeType: "text/plain",', 'mimeType: "application/unknown",'), false);

const dockerfile = readFileSync(join(repo, 'deploy/Dockerfile'), 'utf8');
assert.match(dockerfile, /USER root/);
for (const name of ['x11vnc', 'novnc', 'websockify']) assert.match(dockerfile, new RegExp('\\b'+name+'\\b'));
const entry = readFileSync(join(repo, 'deploy/entrypoint.sh'), 'utf8');
assert.match(entry, /-viewonly/);
assert.match(entry, /-localhost/);
assert.match(entry, /127\.0\.0\.1:6080/);
assert.match(entry, /--no-sandbox/);
assert.doesNotMatch(entry, /gosu rakazo/);
assert.match(entry, /docker-entrypoint\.sh postgres/);
assert.match(entry, /--host 127\.0\.0\.1 --port 5173/);
console.log('PASS: root packaging, view-only loopback VNC, patch fixture, fail-closed behavior');
