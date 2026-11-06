#!/usr/bin/env bash
# Offline static checks. Does NOT build or run the full image.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"

bash -n "$repo/deploy/entrypoint.sh" "$repo/deploy/desktopctl"
node --check "$repo/deploy/patch-desktop.mjs"
node --check "$repo/deploy/health.mjs"

REPO="$repo" python3 - <<'PY'
import os, pathlib, yaml
repo=pathlib.Path(os.environ['REPO'])
wf=yaml.load((repo/'.github/workflows/build-image.yml').read_text(), Loader=yaml.BaseLoader)
assert 'build' in wf['jobs']
assert wf['jobs']['build']['permissions']['packages'] == 'write'
assert any('docker/build-push-action' in s.get('uses', '') for s in wf['jobs']['build']['steps'])
assert 'workflow_dispatch' in wf['on']
Dockerfile=(repo/'deploy/Dockerfile').read_text()
assert 'FROM postgres:16-bookworm' in Dockerfile
assert 'EXPOSE 7860' in Dockerfile
assert 'PGDATA=/var/lib/rakazo/pgdata' in Dockerfile
assert '/mnt/workspace' not in Dockerfile
print('Workflow / Dockerfile static checks passed')
PY

# Test exact-count fail-closed patch mechanics against the known upstream source markers.
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/packages/adapters/src" "$temp/infra/modelscope-single"
cat > "$temp/packages/adapters/src/desktop-sandbox.ts" <<'SOURCE'
import { removeOwnedWorkspaceChildren } from "./desktop-workspace-cleanup.js";
function describeDesktopSandbox() {
  return {
    capabilities: {
      graphical: false,
    },
  };
}
async function sendInput(input) {
    const box = this.boxFor(computer);
    if (box) applyPlaceholderAction(box, input);
}
async function observe(computer) {
    return placeholderObservation(this.requiredBox(computer).screen);
}
async function act(computer, request) {
    for (const action of actions) applyPlaceholderAction(box, action);
}
SOURCE
cp "$repo/deploy/desktop-x11.ts" "$temp/infra/modelscope-single/desktop-x11.ts"
(cd "$temp" && node "$repo/deploy/patch-desktop.mjs")
REPO="$temp" python3 - <<'PY'
import pathlib, os
p=pathlib.Path(os.environ['REPO'])
s=(p/'packages/adapters/src/desktop-sandbox.ts').read_text()
assert 'graphical: process.env.RAKAZO_X11 === "1"' in s
assert 'await actX11(action)' in s
assert 'return observeX11()' in s
assert (p/'packages/adapters/src/desktop-x11.ts').exists()
print('Desktop Provider patch fixture passed')
PY
if (cd "$temp" && node "$repo/deploy/patch-desktop.mjs" >/dev/null 2>&1); then
  echo 'Patch must fail when applied twice' >&2
  exit 1
fi

# TypeScript syntax check if global TypeScript is available.
if [[ -n "$(command -v tsc || true)" ]]; then
  TS_ROOT="$(npm root -g)" REPO="$repo" node <<'JS'
const fs = require('fs');
const path = require('path');
const ts = require(path.join(process.env.TS_ROOT, 'typescript'));
const file = path.join(process.env.REPO, 'deploy/desktop-x11.ts');
const text = fs.readFileSync(file, 'utf8');
const out = ts.transpileModule(text, {fileName:file, reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const errs = (out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
if (errs.length) {
  for (const e of errs) console.error(ts.flattenDiagnosticMessageText(e.messageText, '\n'));
  process.exit(1);
}
console.log('TypeScript syntax passed');
JS
fi

# Start the isolated health server and test both endpoints without any other service.
REPO="$repo" python3 - <<'PY'
import os, subprocess, time, urllib.request, urllib.error
p=subprocess.Popen(['node', os.path.join(os.environ['REPO'],'deploy/health.mjs')],
                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            with urllib.request.urlopen('http://127.0.0.1:7860/health',timeout=.5) as r:
                assert r.status == 200
            break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Health endpoint did not start')
    try:
        urllib.request.urlopen('http://127.0.0.1:7860/ready',timeout=2)
        raise RuntimeError('/ready should be 503 without app/database')
    except urllib.error.HTTPError as e:
        assert e.code == 503, e.code
    print('Health / readiness endpoints passed')
finally:
    p.terminate()
    p.wait(timeout=5)
PY

echo 'ALL OFFLINE STATIC CHECKS PASSED'
