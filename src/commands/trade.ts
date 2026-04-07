import { Command } from 'commander';
import chalk from 'chalk';
import { encodeFunctionData, parseUnits } from 'viem';
import { getNetworkConfig, type NetworkName } from '../config.js';
import { createReader, createWriter } from '../client.js';
import { exchangeRouterAbi } from '../abi/exchange-router.js';
import { syntheticsReaderAbi } from '../abi/reader.js';
import { erc20Abi } from '../abi/erc20.js';
import { loadAccount } from '../wallet.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const DEFAULT_EXECUTION_FEE = parseUnits('0.001', 18);

// GMX v2 order types
const ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  Liquidation: 7,
} as const;

const DECREASE_POSITION_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2,
} as const;

interface MarketEntry {
  marketToken: `0x${string}`;
  indexToken: `0x${string}`;
  longToken: `0x${string}`;
  shortToken: `0x${string}`;
}

interface SymbolMapResult {
  markets: Map<string, MarketEntry>; // symbol (e.g. "BTC/USD") → market
  prices: Map<string, number>; // symbol → current price (USD)
}

async function buildSymbolToMarketMap(
  client: ReturnType<typeof createReader>,
  config: ReturnType<typeof getNetworkConfig>,
): Promise<SymbolMapResult> {
  const [marketsRaw, priceRes] = await Promise.all([
    client.readContract({
      address: config.contracts.syntheticsReader,
      abi: syntheticsReaderAbi,
      functionName: 'getMarkets',
      args: [config.contracts.dataStore, 0n, 200n],
    }) as any as Array<MarketEntry>,
    fetch(`${config.api.oracleBaseUrl}/api/v1/latestPrice?get_all=true`).then(r => r.json()) as Promise<{
      data: { prices: Array<{ symbol: string; bsc_token_addr: string; price: string }> };
    }>,
  ]);

  const addrToSymbol = new Map<string, string>();
  const prices = new Map<string, number>();
  for (const p of priceRes.data.prices) {
    addrToSymbol.set(p.bsc_token_addr.toLowerCase(), p.symbol);
    prices.set(p.symbol.toUpperCase(), Number(p.price));
  }

  const markets = new Map<string, MarketEntry>();
  for (const m of marketsRaw) {
    if (m.indexToken === ZERO_ADDRESS) continue;
    const sym = addrToSymbol.get(m.indexToken.toLowerCase());
    if (sym) markets.set(sym.toUpperCase(), m);
  }
  return { markets, prices };
}

function resolveMarket(
  result: SymbolMapResult,
  symbol: string,
): { symbol: string; market: MarketEntry; price: number } {
  const upper = symbol.toUpperCase();
  const candidates: string[] = [];

  // Exact match
  if (result.markets.has(upper)) candidates.push(upper);
  else if (result.markets.has(`${upper}/USD`)) candidates.push(`${upper}/USD`);
  else {
    // Strict prefix match: "BTC" must match "BTC/..." not "BTCB/..."
    for (const key of result.markets.keys()) {
      if (key === upper || key.startsWith(`${upper}/`)) candidates.push(key);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Market not found for "${symbol}". Use \`hz market list\` to see available markets.`);
  }
  if (candidates.length > 1) {
    throw new Error(`Ambiguous symbol "${symbol}". Matches: ${candidates.join(', ')}. Use the full symbol (e.g. "${candidates[0]}").`);
  }

  const matched = candidates[0]!;
  const market = result.markets.get(matched)!;
  const price = result.prices.get(matched);
  if (!price || price <= 0) {
    throw new Error(`No live price for ${matched}. Cannot compute slippage protection.`);
  }
  return { symbol: matched, market, price };
}

/**
 * Compute acceptablePrice with slippage tolerance, in 30-decimal USD.
 * For LONG: acceptablePrice = price * (1 + slippage) — willing to BUY at higher
 * For SHORT: acceptablePrice = price * (1 - slippage) — willing to SELL at lower
 */
function computeAcceptablePrice(currentPriceUsd: number, isLong: boolean, slippageBps: number): bigint {
  const slippageMultiplier = isLong
    ? 1 + slippageBps / 10_000
    : 1 - slippageBps / 10_000;
  const target = currentPriceUsd * slippageMultiplier;
  // Convert to 30-decimal fixed point. Use string to avoid float precision loss.
  return parseUnits(target.toFixed(18), 30);
}

function validateTradeParams(leverage: number, collateral: number, slippageBps: number): void {
  if (!Number.isFinite(leverage) || leverage < 1.1) {
    throw new Error(`Invalid leverage: ${leverage}. Must be >= 1.1`);
  }
  if (leverage > 1000) {
    throw new Error(`Leverage ${leverage}x exceeds max 1000x.`);
  }
  if (!Number.isFinite(collateral) || collateral < 10) {
    throw new Error(`Collateral must be at least 10 USDT (got ${collateral}).`);
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new Error(`Slippage ${slippageBps}bps out of range. Must be 0–1000 bps (0–10%).`);
  }
}

async function waitReceipt(
  client: ReturnType<typeof createReader>,
  hash: `0x${string}`,
  label: string,
): Promise<void> {
  console.log(chalk.dim(`Waiting for ${label} confirmation...`));
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') {
    throw new Error(`${label} transaction reverted. TX: ${hash}`);
  }
}

async function openPosition(
  symbol: string,
  isLong: boolean,
  leverage: number,
  collateralUsdt: number,
  slippageBps: number,
) {
  validateTradeParams(leverage, collateralUsdt, slippageBps);

  const network = (tradeCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
  const config = getNetworkConfig(network);
  const account = await loadAccount();
  const reader = createReader(config);
  const writer = createWriter(config, account);

  console.log(chalk.dim(`Resolving ${symbol} market...`));
  const symbolMap = await buildSymbolToMarketMap(reader, config);
  const { symbol: matchedSymbol, market, price: currentPrice } = resolveMarket(symbolMap, symbol);

  const collateralAmount = parseUnits(collateralUsdt.toString(), 6);
  const sizeDeltaUsd = parseUnits((collateralUsdt * leverage).toString(), 30);
  const acceptablePrice = computeAcceptablePrice(currentPrice, isLong, slippageBps);

  // Show user what's about to happen — this is the only confirmation
  console.log('');
  console.log(chalk.bold(`${isLong ? 'LONG' : 'SHORT'} ${matchedSymbol}`));
  console.log(`  Market token:    ${market.marketToken}`);
  console.log(`  Mark price:      $${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`);
  console.log(`  Acceptable:      $${(currentPrice * (isLong ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000)).toLocaleString(undefined, { maximumFractionDigits: 6 })} (${slippageBps}bps slippage)`);
  console.log(`  Size:            $${(collateralUsdt * leverage).toLocaleString()} (${leverage}x)`);
  console.log(`  Collateral:      ${collateralUsdt} USDT`);
  console.log('');

  const orderParams = {
    addresses: {
      receiver: account.address,
      cancellationReceiver: account.address,
      callbackContract: ZERO_ADDRESS,
      uiFeeReceiver: ZERO_ADDRESS,
      market: market.marketToken,
      initialCollateralToken: market.shortToken,
      swapPath: [] as `0x${string}`[],
    },
    numbers: {
      sizeDeltaUsd,
      initialCollateralDeltaAmount: collateralAmount,
      triggerPrice: 0n,
      acceptablePrice,
      executionFee: DEFAULT_EXECUTION_FEE,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n,
    },
    orderType: ORDER_TYPE.MarketIncrease,
    decreasePositionSwapType: DECREASE_POSITION_SWAP_TYPE.NoSwap,
    isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ZERO_BYTES32,
    dataList: [] as `0x${string}`[],
  };

  // Step 1: Approve USDT — wait for confirmation before proceeding
  console.log(chalk.dim('Approving USDT...'));
  const approveHash = await writer.writeContract({
    chain: config.chain,
    account,
    address: market.shortToken,
    abi: erc20Abi,
    functionName: 'approve',
    args: [config.contracts.syntheticsRouter, collateralAmount],
  });
  await waitReceipt(reader, approveHash, 'Approve');

  // Step 2: multicall — sendWnt + sendTokens + createOrder
  console.log(chalk.dim('Submitting order...'));
  const txHash = await writer.writeContract({
    chain: config.chain,
    account,
    address: config.contracts.exchangeRouter,
    abi: exchangeRouterAbi,
    functionName: 'multicall',
    args: [[
      encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'sendWnt', args: [config.contracts.orderVault, DEFAULT_EXECUTION_FEE] }),
      encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'sendTokens', args: [market.shortToken, config.contracts.orderVault, collateralAmount] }),
      encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'createOrder', args: [orderParams] }),
    ]],
    value: DEFAULT_EXECUTION_FEE,
  });
  await waitReceipt(reader, txHash, 'Order');

  console.log('');
  console.log(chalk.green(`${isLong ? 'LONG' : 'SHORT'} ${symbol} — order confirmed`));
  console.log(`Size:       $${(collateralUsdt * leverage).toLocaleString()} (${leverage}x)`);
  console.log(`Collateral: ${collateralUsdt} USDT`);
  console.log(`TX:         ${txHash}`);
}

export const tradeCmd = new Command('trade').description('Open and close positions');

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

tradeCmd
  .command('long')
  .description('Open a long position')
  .argument('<symbol>', 'Token symbol (e.g. BTC, ETH)')
  .argument('<leverage>', 'Leverage multiplier (e.g. 10, 50, 100)')
  .argument('<collateral>', 'Collateral amount in USDT (min 10)')
  .option('--slippage <bps>', 'Slippage tolerance in basis points (default 50 = 0.5%)', String(DEFAULT_SLIPPAGE_BPS))
  .action(async (symbol: string, leverage: string, collateral: string, opts: { slippage: string }) => {
    try {
      await openPosition(symbol, true, Number(leverage), Number(collateral), Number(opts.slippage));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

tradeCmd
  .command('short')
  .description('Open a short position')
  .argument('<symbol>', 'Token symbol (e.g. BTC, ETH)')
  .argument('<leverage>', 'Leverage multiplier')
  .argument('<collateral>', 'Collateral amount in USDT (min 10)')
  .option('--slippage <bps>', 'Slippage tolerance in basis points (default 50 = 0.5%)', String(DEFAULT_SLIPPAGE_BPS))
  .action(async (symbol: string, leverage: string, collateral: string, opts: { slippage: string }) => {
    try {
      await openPosition(symbol, false, Number(leverage), Number(collateral), Number(opts.slippage));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

tradeCmd
  .command('close')
  .description('Close a position (market decrease)')
  .argument('<market-token>', 'Market token address')
  .option('--long', 'Close long position')
  .option('--short', 'Close short position')
  .option('--size <usd>', 'Partial close size in USD (default: close all)')
  .option('--slippage <bps>', 'Slippage tolerance in basis points (default 50 = 0.5%)', String(DEFAULT_SLIPPAGE_BPS))
  .action(async (marketToken: string, opts: { long?: boolean; short?: boolean; size?: string; slippage: string }) => {
    try {
      const isLong = opts.long ? true : opts.short ? false : (() => { throw new Error('Specify --long or --short'); })();
      const slippageBps = Number(opts.slippage);
      if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
        throw new Error(`Slippage ${slippageBps}bps out of range (0–1000).`);
      }
      const network = (tradeCmd.parent?.opts() as { network?: string })?.network as NetworkName || 'testnet';
      const config = getNetworkConfig(network);
      const account = await loadAccount();
      const reader = createReader(config);
      const writer = createWriter(config, account);

      // Look up the market's index symbol + price for slippage protection
      const symbolMap = await buildSymbolToMarketMap(reader, config);
      let marketSymbol: string | undefined;
      let markPrice: number | undefined;
      for (const [sym, m] of symbolMap.markets) {
        if (m.marketToken.toLowerCase() === marketToken.toLowerCase()) {
          marketSymbol = sym;
          markPrice = symbolMap.prices.get(sym);
          break;
        }
      }
      if (!markPrice) {
        throw new Error(`Could not resolve mark price for market ${marketToken}. Refusing to close without slippage protection.`);
      }

      const positions = await reader.readContract({
        address: config.contracts.syntheticsReader,
        abi: syntheticsReaderAbi,
        functionName: 'getAccountPositions',
        args: [config.contracts.dataStore, account.address, 0n, 50n],
      }) as any as Array<{
        addresses: { account: `0x${string}`; market: `0x${string}`; collateralToken: `0x${string}` };
        numbers: { sizeInUsd: bigint; collateralAmount: bigint };
        flags: { isLong: boolean };
      }>;

      const pos = positions.find(
        (p) => p.addresses.market.toLowerCase() === marketToken.toLowerCase() && p.flags.isLong === isLong,
      );
      if (!pos) throw new Error('Position not found. Use `hz position list` to check open positions.');

      const sizeDeltaUsd = opts.size ? parseUnits(opts.size, 30) : pos.numbers.sizeInUsd;
      // Closing a LONG = selling (accept lower price). Closing a SHORT = buying back (accept higher price).
      const acceptablePrice = computeAcceptablePrice(markPrice, !isLong, slippageBps);

      console.log('');
      console.log(chalk.bold(`CLOSE ${isLong ? 'LONG' : 'SHORT'} ${marketSymbol ?? marketToken}`));
      console.log(`  Mark price:   $${markPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`);
      console.log(`  Size:         ${opts.size ? `$${opts.size}` : 'FULL'}`);
      console.log(`  Slippage:     ${slippageBps}bps`);
      console.log('');

      const orderParams = {
        addresses: {
          receiver: account.address,
          cancellationReceiver: account.address,
          callbackContract: ZERO_ADDRESS,
          uiFeeReceiver: ZERO_ADDRESS,
          market: marketToken as `0x${string}`,
          initialCollateralToken: pos.addresses.collateralToken,
          swapPath: [] as `0x${string}`[],
        },
        numbers: {
          sizeDeltaUsd,
          initialCollateralDeltaAmount: 0n,
          triggerPrice: 0n,
          acceptablePrice,
          executionFee: DEFAULT_EXECUTION_FEE,
          callbackGasLimit: 0n,
          minOutputAmount: 0n,
          validFromTime: 0n,
        },
        orderType: ORDER_TYPE.MarketDecrease,
        decreasePositionSwapType: DECREASE_POSITION_SWAP_TYPE.NoSwap,
        isLong,
        shouldUnwrapNativeToken: false,
        autoCancel: false,
        referralCode: ZERO_BYTES32,
        dataList: [] as `0x${string}`[],
      };

      console.log(chalk.dim('Submitting close order...'));
      const txHash = await writer.writeContract({
        chain: config.chain,
        account,
        address: config.contracts.exchangeRouter,
        abi: exchangeRouterAbi,
        functionName: 'multicall',
        args: [[
          encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'sendWnt', args: [config.contracts.orderVault, DEFAULT_EXECUTION_FEE] }),
          encodeFunctionData({ abi: exchangeRouterAbi, functionName: 'createOrder', args: [orderParams] }),
        ]],
        value: DEFAULT_EXECUTION_FEE,
      });
      await waitReceipt(reader, txHash, 'Close order');

      console.log(chalk.green('Position close order confirmed'));
      console.log(`TX: ${txHash}`);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });
