import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const names = ['state.json', 'recovery-state.json', 'leads.jsonl', 'voice-transfers.json', 'billing-test-state.json'];
function keyFrom(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('BACKUP_ENCRYPTION_KEY must be a 32-byte hex key');
  return Buffer.from(value, 'hex');
}
function validate(name, data) {
  if (name.endsWith('.jsonl')) {
    for (const line of data.toString('utf8').split('\n').filter(line => line.trim())) JSON.parse(line);
  } else JSON.parse(data.toString('utf8'));
}
export async function createBackup({ sources, destination, key, quiesced }) {
  if (!quiesced) throw new Error('Use a stopped writer or an isolated consistent snapshot; set BACKUP_QUIESCED=yes only after confirming');
  const encryptionKey = keyFrom(key);
  const files = [];
  const missing = [];
  for (const name of names) {
    try {
      const data = await fs.readFile(sources[name]);
      validate(name, data);
      files.push({ name, data: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(name);
    }
  }
  if (!files.length) throw new Error('No state files found; backup refused');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const payload = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files, missing }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, envelope, { flag: 'wx', mode: 0o600 });
  return { ok: true, destination, included: files.map(file => file.name), missing, complete: missing.length === 0 };
}
export async function restoreBackup({ archive, destination, key }) {
  const envelope = JSON.parse(await fs.readFile(archive, 'utf8'));
  if (envelope.version !== 1) throw new Error('Unknown backup version');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(key), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString());
  if (payload.version !== 1 || !Array.isArray(payload.files) || !payload.files.length) throw new Error('Invalid archive');
  const seen = new Set();
  for (const file of payload.files) {
    if (!names.includes(file.name) || seen.has(file.name)) throw new Error('Invalid archive file');
    seen.add(file.name);
    const data = Buffer.from(file.data, 'base64');
    if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('Checksum mismatch');
    validate(file.name, data);
  }
  // A new directory is mandatory: never overwrite production or an earlier restore.
  await fs.mkdir(destination, { mode: 0o700 });
  for (const file of payload.files) await fs.writeFile(path.join(destination, file.name), Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
  return { ok: true, destination, restored: [...seen], missing: payload.missing };
}
export async function main() {
  const env = process.env;
  if (process.argv[2] === 'restore') {
    if (!env.BACKUP_ARCHIVE || !env.RESTORE_DIRECTORY) throw new Error('Set BACKUP_ARCHIVE and a new isolated RESTORE_DIRECTORY');
    return restoreBackup({ archive: env.BACKUP_ARCHIVE, destination: path.resolve(env.RESTORE_DIRECTORY), key: env.BACKUP_ENCRYPTION_KEY });
  }
  const state = env.STATE_FILE || './data/state.json';
  const sources = {
    'state.json': state,
    'recovery-state.json': env.RECOVERY_STATE_FILE || './data/recovery-state.json',
    'leads.jsonl': env.LEADS_FILE || './data/leads.jsonl',
    'voice-transfers.json': path.join(path.dirname(state), 'voice-transfers.json'),
    'billing-test-state.json': env.BILLING_STATE_FILE || path.join(path.dirname(state), 'billing-test-state.json')
  };
  const destination = path.resolve(env.BACKUP_DIRECTORY || './backups', `${Date.now()}-${randomBytes(4).toString('hex')}.brbackup`);
  return createBackup({ sources, destination, key: env.BACKUP_ENCRYPTION_KEY, quiesced: env.BACKUP_QUIESCED === 'yes' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Backup operation failed; check configuration, snapshot consistency, archive integrity, and destination permissions.'); process.exitCode = 1; });
}
