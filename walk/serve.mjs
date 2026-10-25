// The built app under its own headers, as the host will send them: every response carries the `/*`
// block of dist/_headers (the policy among them), so a walk against it meets what production meets.
//   node walk/serve.mjs [dist] [port]     then PARLOR_URL=http://localhost:<port>/ node walk/walk.mjs <engine>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const root = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 30338);
const block = readFileSync(join(root, '_headers'), 'utf-8').split(/\r?\n\r?\n/)[0].split(/\r?\n/);
if (block[0].trim() !== '/*') throw new Error('the first block of _headers is not /*');
const headers = Object.fromEntries(block.slice(1).map(l => l.trim()).filter(Boolean).map(l => {
  const i = l.indexOf(':');
  return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = join(root, path || 'index.html');
  if (!file.startsWith(normalize(root)) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`serving ${root} under its _headers on ${port}: ${headers['Content-Security-Policy']}`));
