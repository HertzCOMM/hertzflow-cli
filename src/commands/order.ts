import { Command } from 'commander';
import chalk from 'chalk';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { createReader, createWriter } from '../client.js';
import { syntheticsReaderAbi } from '../abi/reader.js';
import { exchangeRouterAbi } from '../abi/exchange-router.js';
import { loadAccount } from '../wallet.js';
import { output, formatUsd, type OutputOptions } from '../utils/format.js';

const ORDER_TYPE_NAMES: Record<number, string> = {
  0: 'MarketSwap',
  1: 'LimitSwap',
  2: 'MarketIncrease',
  3: 'LimitIncrease',
  4: 'MarketDecrease',
  5: 'LimitDecrease',
  6: 'StopLossDecrease',
  7: 'Liquidation',
};

export const orderCmd = new Command('order').description('Order management');

orderCmd
  .command('list')
  .description('List all pending orders')
  .option('-a, --address <address>', 'Query a specific address')
  .option('--json', 'Output as JSON')
  .action(async (opts: OutputOptions & { address?: string }) => {
    try {
      const network = (orderCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const client = createReader(config);

      let account: string;
      if (opts.address) {
        account = opts.address;
      } else {
        const acc = await loadAccount();
        account = acc.address;
      }

      const orders = await client.readContract({
        address: config.contracts.syntheticsReader,
        abi: syntheticsReaderAbi,
        functionName: 'getAccountOrders',
        args: [config.contracts.dataStore, account as `0x${string}`, 0n, 50n],
      }) as any as Array<{
        orderKey: `0x${string}`;
        order: {
          addresses: { account: `0x${string}`; market: `0x${string}` };
          numbers: { orderType: number; sizeDeltaUsd: bigint; triggerPrice: bigint };
          flags: { isLong: boolean };
        };
      }>;

      if (orders.length === 0) {
        console.log(chalk.dim('No pending orders'));
        return;
      }

      const rows = orders.map((o) => ({
        key: o.orderKey.slice(0, 10) + '...',
        market: o.order.addresses.market.slice(0, 10) + '...',
        type: ORDER_TYPE_NAMES[o.order.numbers.orderType] || `Unknown(${o.order.numbers.orderType})`,
        side: o.order.flags.isLong ? chalk.green('LONG') : chalk.red('SHORT'),
        sizeUsd: formatUsd(o.order.numbers.sizeDeltaUsd),
      }));

      output(opts.json ? orders : rows, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

orderCmd
  .command('cancel')
  .description('Cancel a pending order')
  .argument('<order-key>', 'Order key (bytes32)')
  .action(async (orderKey: string) => {
    try {
      const network = (orderCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const account = await loadAccount();
      const client = createWriter(config, account);

      const hash = await client.writeContract({
        chain: config.chain,
        account,
        address: config.contracts.exchangeRouter,
        abi: exchangeRouterAbi,
        functionName: 'cancelOrder',
        args: [orderKey as `0x${string}`],
      });

      console.log(chalk.green('Order cancelled'));
      console.log(`TX: ${hash}`);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
