import { Command } from 'commander';
import chalk from 'chalk';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { output, type OutputOptions } from '../utils/format.js';

const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;

// Interval to seconds mapping for calculating start_time
const INTERVAL_SECS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
};

interface KlineBar {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export const klineCmd = new Command('kline')
  .description('Get historical candlestick data')
  .argument('<symbol>', 'Token symbol (e.g. BTC, ETH)')
  .argument('[interval]', 'Candle interval: 1m|5m|15m|30m|1h|4h|1d|1w', '1h')
  .option('-n, --limit <count>', 'Number of candles', '50')
  .option('--json', 'Output as JSON')
  .action(async (symbol: string, interval: string, opts: OutputOptions & { limit: string }) => {
    try {
      if (!VALID_INTERVALS.includes(interval as typeof VALID_INTERVALS[number])) {
        throw new Error(`Invalid interval. Valid: ${VALID_INTERVALS.join(', ')}`);
      }
      const network = (klineCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const limit = parseInt(opts.limit, 10);
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - (INTERVAL_SECS[interval]! * limit);

      const pairSymbol = symbol.toUpperCase().includes('/') ? symbol.toUpperCase() : `${symbol.toUpperCase()}/USD`;
      const url = `${config.api.klineBaseUrl}/api/v1/historyKLines?symbol=${encodeURIComponent(pairSymbol)}&interval=${interval}&limit=${limit}&start_time=${startTime}&end_time=${endTime}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Kline API error: ${res.status}`);
      const body = await res.json() as {
        code: number;
        data: { candles: Array<{ timestamp: number; open: string; high: string; low: string; close: string }> } | null;
        error?: string;
      };

      if (body.code !== 200 || !body.data) {
        throw new Error(body.error || `Kline API returned code ${body.code}`);
      }

      const bars: KlineBar[] = body.data.candles.map((k) => ({
        time: new Date(k.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' '),
        open: Number(k.open).toFixed(2),
        high: Number(k.high).toFixed(2),
        low: Number(k.low).toFixed(2),
        close: Number(k.close).toFixed(2),
      }));

      output(bars, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
