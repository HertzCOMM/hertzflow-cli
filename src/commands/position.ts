import { Command } from 'commander';
import chalk from 'chalk';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { createReader } from '../client.js';
import { syntheticsReaderAbi } from '../abi/reader.js';
import { erc20Abi } from '../abi/erc20.js';
import { loadAccount } from '../wallet.js';
import { output, formatUsd, formatToken, type OutputOptions } from '../utils/format.js';

export const positionCmd = new Command('position').description('Position queries');

positionCmd
  .command('list')
  .description('List all open positions for your wallet')
  .option('-a, --address <address>', 'Query a specific address instead of your wallet')
  .option('--json', 'Output as JSON')
  .action(async (opts: OutputOptions & { address?: string }) => {
    try {
      const network = (positionCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const client = createReader(config);

      let account: string;
      if (opts.address) {
        account = opts.address;
      } else {
        const acc = await loadAccount();
        account = acc.address;
      }

      const positions = await client.readContract({
        address: config.contracts.syntheticsReader,
        abi: syntheticsReaderAbi,
        functionName: 'getAccountPositions',
        args: [config.contracts.dataStore, account as `0x${string}`, 0n, 50n],
      }) as any as Array<{
        addresses: { account: `0x${string}`; market: `0x${string}`; collateralToken: `0x${string}` };
        numbers: { sizeInUsd: bigint; sizeInTokens: bigint; collateralAmount: bigint };
        flags: { isLong: boolean };
      }>;

      if (positions.length === 0) {
        console.log(chalk.dim('No open positions'));
        return;
      }

      const rows = positions.map((p) => ({
        market: p.addresses.market.slice(0, 10) + '...',
        side: p.flags.isLong ? chalk.green('LONG') : chalk.red('SHORT'),
        sizeUsd: formatUsd(p.numbers.sizeInUsd),
        collateral: formatToken(p.numbers.collateralAmount),
        collateralToken: p.addresses.collateralToken.slice(0, 10) + '...',
      }));

      output(opts.json ? positions : rows, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
