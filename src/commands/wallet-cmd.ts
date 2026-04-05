import { Command } from 'commander';
import chalk from 'chalk';
import { privateKeyToAccount } from 'viem/accounts';
import { createWallet, importWallet, getKeystoreAddress, KEYSTORE_PATH, promptSecretInput } from '../wallet.js';

export const walletCmd = new Command('wallet').description('Wallet management');

walletCmd
  .command('create')
  .description('Generate a new wallet and save to encrypted keystore')
  .action(async () => {
    try {
      const { address, privateKey } = await createWallet();
      console.log(chalk.green('Wallet created successfully'));
      console.log(`Address:  ${address}`);
      console.log(`Key file: ${KEYSTORE_PATH}`);
      console.log('');
      console.log(chalk.yellow('!! BACK UP YOUR PRIVATE KEY — it will not be shown again !!'));
      console.log(`Private key: ${privateKey}`);
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
