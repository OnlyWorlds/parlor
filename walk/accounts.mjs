// The crew's test accounts, from the file CREW_WALK_ACCOUNTS names (outside this
// repository), read for a walk and never printed. Claim one in h57 before a walk.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = process.env.CREW_WALK_ACCOUNTS;

export function account(label) {
  if (!FILE) throw new Error('set CREW_WALK_ACCOUNTS to the crew\'s accounts file (outside the repo)');
  const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
  const row = lines.find(l => l.startsWith(`${label} `) && l.includes('@'));
  const pinRow = lines.find(l => l.startsWith(`${label} PIN `));
  if (!row) throw new Error(`no account ${label}`);
  const [, email, password] = row.trim().split(/\s+/);
  const pin = pinRow ? pinRow.trim().split(/\s+/)[2] : '';
  return { label, email, password, pin: /^\d+$/.test(pin) ? pin : '' };
}

/** The walk's own state: tokens and ids it minted, so teardown revokes only those. */
export const STATE = process.env.WALK_STATE;
export function readState() {
  if (!STATE) throw new Error('set WALK_STATE to a file outside the repo');
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { tokens: {}, minted: [] };
}
export function writeState(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

export const API = 'https://www.onlyworlds.com/api/v2';

export async function accountCall(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status} ${json?.error?.code ?? ''}`), { status: res.status, body: json });
  return json;
}
