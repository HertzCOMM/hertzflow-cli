import { Command } from 'commander';
import chalk from 'chalk';
import { privateKeyToAccount } from 'viem/accounts';
import { createWallet, importWallet, exportWallet, getKeystoreAddress, KEYSTORE_PATH, promptSecretInput } from '../wallet.js';

export const walletCmd = new Command('wallet').description('Wallet management');

walletCmd
  .command('create')
  .description('Generate a new wallet and save to encrypted keystore')
  .action(async () => {
    try {
      const { address } = await createWallet();
      console.log(chalk.green('Wallet created successfully'));
      console.log(`Address:  ${address}`);
      console.log(`Key file: ${KEYSTORE_PATH}`);
      console.log('');
      console.log(chalk.dim('To reveal the raw private key for backup, run: hz wallet export'));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

walletCmd
  .command('export')
  .description('Reveal the raw private key (after password unlock) — for backup only')
  .action(async () => {
    try {
      console.log(chalk.yellow('!! WARNING: the private key will be printed to stdout. !!'));
      console.log(chalk.yellow('!! Make sure no one is watching and your terminal scrollback is not recorded. !!'));
      console.log('');
      const pk = await exportWallet();
      console.log(chalk.bold('Private key:'));
      console.log(pk);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

walletCmd
  .command('import')
  .description('Import a private key into encrypted keystore (prompted securely, not via args)')
  .action(async () => {
    try {
      const key = await promptSecretInput('Enter private key (0x...): ');
      if (!key.startsWith('0x') || key.length !== 66) {
        throw new Error('Invalid private key format. Expected 0x + 64 hex chars.');
      }
      const address = await importWallet(key);
      console.log(chalk.green('Wallet imported successfully'));
      console.log(`Address:  ${address}`);
      console.log(`Key file: ${KEYSTORE_PATH}`);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

walletCmd
  .command('show')
  .description('Show the current wallet address')
  .action(() => {
    const address = getKeystoreAddress();
    if (address) {
      console.log(address);
    } else {
      const envKey = process.env.HZ_PRIVATE_KEY;
      if (envKey) {
        console.log(privateKeyToAccount(envKey as `0x${string}`).address);
      } else {
        console.error(chalk.dim('No wallet configured. Use `hz wallet create` or set HZ_PRIVATE_KEY.'));
        process.exit(1);
      }
    }
  });
