// Shared helpers for the setup and probe scripts. Zero dependencies (Node >= 18.17).
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

export const HOSTS = {
  facebook: 'graph.facebook.com',
  instagram: 'graph.instagram.com',
};

export class GraphError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.error_user_msg || e.message || (typeof body === 'string' ? body.slice(0, 300) : `HTTP ${status}`));
    this.status = status;
    this.code = e.code;
    this.subcode = e.error_subcode;
    this.type = e.type;
    this.fbtrace = e.fbtrace_id;
  }

  get short() {
    const code = this.code !== undefined ? `#${this.code}${this.subcode ? `/${this.subcode}` : ''}` : `HTTP ${this.status}`;
    return `${code} ${this.message}`;
  }
}

// Calls the Graph API. Values that are objects/arrays are JSON-encoded, as Meta expects.
export async function graph(method, path, { host, version, token, params = {}, json } = {}) {
  const base = `https://${host}/${version ? `${version}/` : ''}`;
  const url = new URL(path.replace(/^\//, ''), base);
  const encode = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const query = { ...params };
  if (token) query.access_token = token;

  const init = { method, headers: {} };
  if (method === 'GET' || method === 'DELETE' || json) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, encode(v));
    if (json) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) form.set(k, encode(v));
    init.body = form;
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok || body?.error) throw new GraphError(res.status, body);
  return body;
}

export function loadEnv(file = '.env') {
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  // Real environment variables win over the file.
  for (const [k, v] of Object.entries(process.env)) if (/^(IG|PROBE)_/.test(k) && v) env[k] = v;
  return env;
}

// Updates keys in .env, keeping other lines, and restricts the file to the current user.
export function writeEnv(updates, file = '.env') {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const pending = { ...updates };
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] in pending) {
      const v = pending[m[1]];
      delete pending[m[1]];
      return `${m[1]}=${v ?? ''}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(pending)) out.push(`${k}=${v ?? ''}`);
  writeFileSync(file, `${out.join('\n')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not supported on some Windows filesystems; .env is gitignored either way.
  }
}

export const mask = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)` : '(none)');

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) args[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

// Prompts on the terminal. Secret answers are not echoed.
export async function ask(question, { secret = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = (s) => (muted ? undefined : write(s));
  const pending = rl.question(question);
  muted = secret;
  const answer = await pending;
  rl.close();
  if (secret) process.stdout.write('\n');
  return answer.trim();
}
