#!/usr/bin/env node

import { Command } from 'commander';
import { walletCmd } from './commands/wallet-cmd.js';
import { priceCmd } from './commands/price.js';
import { klineCmd } from './commands/kline.js';
import { marketCmd } from './commands/market.js';
import { positionCmd } from './commands/position.js';
import { orderCmd } from './commands/order.js';
import { tradeCmd } from './commands/trade.js';

const program = new Command();

program
  .name('hz')
  .description('HertzFlow CLI — permissionless perpetual trading on BNB Chain')
  .version('0.1.0')
  .option('-n, --network <network>', 'Network: testnet | mainnet', 'testnet');

program.addCommand(walletCmd);
program.addCommand(priceCmd);
program.addCommand(klineCmd);
program.addCommand(marketCmd);
program.addCommand(positionCmd);
program.addCommand(orderCmd);
program.addCommand(tradeCmd);

program.parseAsync().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
