import http from 'node:http';
import net from 'node:net';

const checkPort = (port, timeoutMs = 800) => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port });
  let completed = false;
  function finish(ok) {
    if (completed) return;
    completed = true;
    socket.destroy();
    resolve(ok);
  }
  socket.setTimeout(timeoutMs, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'rakazo-modelscope-health' }));
    return;
  }
  if (req.url === '/ready') {
    const [postgres, api, web, vnc, screen] = await Promise.all([
      checkPort(5432), checkPort(3100), checkPort(5173), checkPort(5900), checkPort(6080),
    ]);
    const ready = postgres && api && web && vnc && screen;
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ready, components: { postgres, api, web, vnc, screen } }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(7860, '0.0.0.0', () => {
  console.log('[health] listening on 0.0.0.0:7860');
});
