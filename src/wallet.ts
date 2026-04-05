import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from 'viem/accounts';

const WALLET_DIR = path.join(os.homedir(), '.hertzflow');
const KEYSTORE_PATH = path.join(WALLET_DIR, 'keystore.json');

interface Keystore {
  address: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: { salt: string; iterations: number; keylen: number; digest: string };
    mac: string;
  };
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
}

function encryptPrivateKey(privateKey: string, password: string): Keystore {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const salt = crypto.randomBytes(32);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.slice(2), 'hex')),
    cipher.final(),
  ]);
  const mac = crypto
    .createHmac('sha256', key)
    .update(ciphertext)
    .digest()
    .toString('hex');

  return {
    address: account.address,
    crypto: {
      cipher: 'aes-256-ctr',
      ciphertext: ciphertext.toString('hex'),
      cipherparams: { iv: iv.toString('hex') },
      kdf: 'pbkdf2',
      kdfparams: {
        salt: salt.toString('hex'),
        iterations: 100_000,
        keylen: 32,
        digest: 'sha256',
      },
      mac,
    },
  };
}

function decryptPrivateKey(keystore: Keystore, password: string): `0x${string}` {
  const { crypto: c } = keystore;
  const salt = Buffer.from(c.kdfparams.salt, 'hex');
  const key = deriveKey(password, salt);
  const ciphertext = Buffer.from(c.ciphertext, 'hex');

  const mac = crypto.createHmac('sha256', key).update(ciphertext).digest().toString('hex');
  if (mac !== c.mac) {
    throw new Error('Invalid password');
  }

  const iv = Buffer.from(c.cipherparams.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  const privateKeyBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return `0x${privateKeyBytes.toString('hex')}`;
}

async function promptPassword(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let input = '';
    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function promptSecretInput(prompt: string): Promise<string> {
  return promptPassword(prompt);
}

export function keystoreExists(): boolean {
  return fs.existsSync(KEYSTORE_PATH);
}

export function getKeystoreAddress(): string | null {
  if (!keystoreExists()) return null;
  const ks: Keystore = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8'));
  return ks.address;
}

export async function createWallet(): Promise<{ address: string; privateKey: string }> {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const password = await promptPassword('Set keystore password: ');
  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');

  const keystore = encryptPrivateKey(privateKey, password);
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), { mode: 0o600 });

  return { address: account.address, privateKey };
}

export async function importWallet(privateKey: string): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const password = await promptPassword('Set keystore password: ');
  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');

  const keystore = encryptPrivateKey(privateKey, password);
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  return account.address;
}

export async function loadAccount(): Promise<PrivateKeyAccount> {
  // Mode C: env var
  const envKey = process.env.HZ_PRIVATE_KEY;
  if (envKey) {
    return privateKeyToAccount(envKey as `0x${string}`);
  }

  // Mode B: keystore
  if (!keystoreExists()) {
    throw new Error(
      'No wallet found. Use `hz wallet create` or `hz wallet import`, or set HZ_PRIVATE_KEY env var.',
    );
  }

  const keystore: Keystore = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8'));
  const password = await promptPassword('Keystore password: ');
  const privateKey = decryptPrivateKey(keystore, password);
  return privateKeyToAccount(privateKey);
}

export { KEYSTORE_PATH, WALLET_DIR };
