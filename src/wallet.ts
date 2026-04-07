import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from 'viem/accounts';

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256

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

/**
 * Derive a 64-byte master key, then split into:
 *   - encKey  (bytes 0..32) for AES-256-CTR
 *   - macKey  (bytes 32..64) for HMAC-SHA256 (Encrypt-then-MAC)
 * Using independent enc/mac keys is the standard EtM construction.
 */
function deriveKeys(password: string, salt: Buffer): { encKey: Buffer; macKey: Buffer } {
  const master = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha256');
  return { encKey: master.subarray(0, 32), macKey: master.subarray(32, 64) };
}

function encryptPrivateKey(privateKey: string, password: string): Keystore {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const salt = crypto.randomBytes(32);
  const { encKey, macKey } = deriveKeys(password, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', encKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.slice(2), 'hex')),
    cipher.final(),
  ]);
  // MAC over IV || ciphertext to authenticate both
  const mac = crypto
    .createHmac('sha256', macKey)
    .update(Buffer.concat([iv, ciphertext]))
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
        iterations: PBKDF2_ITERATIONS,
        keylen: 64,
        digest: 'sha256',
      },
      mac,
    },
  };
}

function decryptPrivateKey(keystore: Keystore, password: string): `0x${string}` {
  const { crypto: c } = keystore;
  const salt = Buffer.from(c.kdfparams.salt, 'hex');
  // Backwards-compat: old keystores used keylen=32 with shared enc/mac key
  const isLegacy = c.kdfparams.keylen === 32;
  const iv = Buffer.from(c.cipherparams.iv, 'hex');
  const ciphertext = Buffer.from(c.ciphertext, 'hex');

  let encKey: Buffer;
  let macInput: Buffer;
  let macKey: Buffer;
  if (isLegacy) {
    encKey = crypto.pbkdf2Sync(password, salt, c.kdfparams.iterations, 32, c.kdfparams.digest);
    macKey = encKey;
    macInput = ciphertext;
  } else {
    const master = crypto.pbkdf2Sync(password, salt, c.kdfparams.iterations, c.kdfparams.keylen, c.kdfparams.digest);
    encKey = master.subarray(0, 32);
    macKey = master.subarray(32, 64);
    macInput = Buffer.concat([iv, ciphertext]);
  }

  const expected = crypto.createHmac('sha256', macKey).update(macInput).digest();
  const actual = Buffer.from(c.mac, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Invalid password');
  }

  const decipher = crypto.createDecipheriv('aes-256-ctr', encKey, iv);
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

export async function createWallet(): Promise<{ address: string }> {
  if (keystoreExists()) {
    throw new Error(`Keystore already exists at ${KEYSTORE_PATH}. Move it aside before creating a new wallet.`);
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const password = await promptPassword('Set keystore password: ');
  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');

  const keystore = encryptPrivateKey(privateKey, password);
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), { mode: 0o600 });

  return { address: account.address };
}

export async function exportWallet(): Promise<`0x${string}`> {
  if (!keystoreExists()) {
    throw new Error('No keystore found.');
  }
  const keystore: Keystore = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8'));
  const password = await promptPassword('Keystore password: ');
  return decryptPrivateKey(keystore, password);
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
