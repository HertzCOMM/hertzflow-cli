import { Command } from 'commander';
import chalk from 'chalk';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { output, type OutputOptions } from '../utils/format.js';

interface PriceEntry {
  symbol: string;
  price: string;
  address: string;
}

async function fetchPrices(network: NetworkName): Promise<PriceEntry[]> {
  const config = getNetworkConfig(network);
  const res = await fetch(`${config.api.oracleBaseUrl}/api/v1/latestPrice?get_all=true`);
  if (!res.ok) throw new Error(`Oracle API error: ${res.status}`);
  const body = await res.json() as {
    data: {
      prices: Array<{ symbol: string; price: string; bsc_token_addr: string; timestamp: number }>;
    };
  };

  return body.data.prices.map((p) => ({
    symbol: p.symbol,
    price: `$${Number(p.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
    address: p.bsc_token_addr,
  }));
}

export const priceCmd = new Command('price')
  .description('Get oracle prices for supported tokens')
  .argument('[symbol]', 'Token symbol (e.g. BTC, ETH). Omit for all prices.')
  .option('--json', 'Output as JSON')
  .action(async (symbol: string | undefined, opts: OutputOptions) => {
    try {
      const network = (priceCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      let prices = await fetchPrices(network);
      if (symbol) {
        const upper = symbol.toUpperCase();
        prices = prices.filter((p) => p.symbol.toUpperCase().includes(upper));
        if (prices.length === 0) {
          console.error(chalk.red(`No price found for "${symbol}"`));
          process.exit(1);
        }
      }
      output(prices, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
