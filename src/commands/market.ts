import { Command } from 'commander';
import chalk from 'chalk';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { createReader } from '../client.js';
import { syntheticsReaderAbi } from '../abi/reader.js';
import { output, type OutputOptions } from '../utils/format.js';

interface MarketRow {
  symbol: string;
  marketToken: string;
  indexToken: string;
}

async function buildSymbolMap(network: NetworkName): Promise<Map<string, string>> {
  const config = getNetworkConfig(network);
  const map = new Map<string, string>();
  try {
    const res = await fetch(`${config.api.oracleBaseUrl}/api/v1/latestPrice?get_all=true`);
    if (!res.ok) return map;
    const body = await res.json() as { data: { prices: Array<{ symbol: string; bsc_token_addr: string }> } };
    for (const p of body.data.prices) {
      map.set(p.bsc_token_addr.toLowerCase(), p.symbol);
    }
  } catch { /* fallback: no symbol resolution */ }
  return map;
}

export const marketCmd = new Command('market').description('Market operations');

marketCmd
  .command('list')
  .description('List all available trading markets')
  .option('--json', 'Output as JSON')
  .action(async (opts: OutputOptions) => {
    try {
      const network = (marketCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const client = createReader(config);

      const [markets, symbolMap] = await Promise.all([
        client.readContract({
          address: config.contracts.syntheticsReader,
          abi: syntheticsReaderAbi,
          functionName: 'getMarkets',
          args: [config.contracts.dataStore, 0n, 200n],
        }) as any as Array<{ marketToken: `0x${string}`; indexToken: `0x${string}`; longToken: `0x${string}`; shortToken: `0x${string}` }>,
        buildSymbolMap(network),
      ]);

      const rows: MarketRow[] = [];
      for (const m of markets) {
        if (m.indexToken === '0x0000000000000000000000000000000000000000') continue;
        const symbol = symbolMap.get(m.indexToken.toLowerCase()) || m.indexToken.slice(0, 12) + '...';
        rows.push({
          symbol,
          marketToken: m.marketToken,
          indexToken: m.indexToken,
        });
      }

      rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
      output(rows, opts);
      if (!opts.json) {
        console.log(chalk.dim(`\n${rows.length} markets`));
      }
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
