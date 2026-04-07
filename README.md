# hertzflow-cli (`hz`)

Command-line client for [HertzFlow](https://hertzflow.xyz) — permissionless perpetual trading on BNB Chain.

> **Status:** v0.1.0 — BSC **testnet only**. Mainnet contracts are not yet deployed and the CLI will refuse to run against `--network mainnet`.

---

## Install

```bash
git clone https://github.com/HertzCOMM/hertzflow-cli.git
cd hertzflow-cli
npm install
npm run build
node dist/index.js --help
# (or symlink dist/index.js as `hz` somewhere on your $PATH)
```

Requires Node.js ≥ 20.

---

## Quick start

```bash
# 1. Create a wallet (encrypted keystore at ~/.hertzflow/keystore.json, mode 0600)
hz wallet create

# 2. Fund it with tBNB + testnet USDT (from the HertzFlow faucet on the website)

# 3. Check live prices and markets
hz price BTC
hz market list

# 4. Open a 10x long on BTC with 50 USDT collateral
hz trade long BTC 10 50

# 5. Check positions
hz position list

# 6. Close it
hz trade close <market-token> --long
```

---

## Commands

### Wallet
```
hz wallet create               # generate a new encrypted keystore
hz wallet import               # import an existing private key (prompted via stdin, never argv)
hz wallet export               # decrypt and print the raw private key (for backup)
hz wallet show                 # print the active wallet address
```

### Market data
```
hz price [symbol]              # oracle prices for one or all supported pairs
hz kline <symbol> [interval]   # historical candlesticks (1m|5m|15m|30m|1h|4h|1d|1w)
hz market list                 # all available perpetual markets (on-chain Reader)
```

### Positions & orders
```
hz position list [-a <address>]
hz order list    [-a <address>]
hz order cancel  <order-key>
```

### Trading
```
hz trade long  <symbol> <leverage> <collateral-usdt> [--slippage <bps>]
hz trade short <symbol> <leverage> <collateral-usdt> [--slippage <bps>]
hz trade close <market-token> --long|--short [--size <usd>] [--slippage <bps>]
```

- `leverage` — 1.1 to **100** (CLI cap; HertzFlow's per-asset cap may be higher — raise the constant in `src/commands/trade.ts` if you really need it)
- `collateral` — minimum 10 USDT
- `--slippage` — basis points, default `50` (0.5%), max `1000` (10%)
- **Every `trade long/short/close` prints the order details and asks `[y/N]` before signing.** Bypass with `HZ_YES=1` for non-interactive scripts.
- All commands support `--json` for agent / script integration
- All commands support `-n testnet | mainnet` (mainnet currently disabled)

---

## Wallet & key management

The CLI supports two key sources:

| Mode | How | When to use |
|------|-----|-------------|
| **B — encrypted keystore** | `hz wallet create` / `hz wallet import` → `~/.hertzflow/keystore.json` | Interactive use |
| **C — env var** | `export HZ_PRIVATE_KEY=0x...` | Scripts, CI, agents |

### Keystore format

- AES-256-CTR encryption with **Encrypt-then-MAC** (HMAC-SHA256 over `IV ‖ ciphertext`)
- PBKDF2-HMAC-SHA256 with **600 000 iterations** and a **64-byte** master key, split into independent encryption and MAC sub-keys
- Random 32-byte salt and 16-byte IV per keystore
- File mode `0600`
- Constant-time MAC comparison via `crypto.timingSafeEqual`

> ⚠️ This keystore is **not** Ethereum standard keystore v3 (geth/MetaMask use scrypt + Keccak). It cannot be imported into other wallets directly. Use `hz wallet export` to recover the raw private key, then re-import it elsewhere.

### Migrating a legacy keystore

Keystores created before commit `0aaaaa8` use 100 000 PBKDF2 iterations and a single key for both encryption and HMAC. The CLI still decrypts them but prints a warning on every invocation. To migrate:

```bash
hz wallet export                                        # paste current password, copy the printed key
mv ~/.hertzflow/keystore.json ~/.hertzflow/keystore.legacy.json
hz wallet import                                        # paste the key, set a fresh password
rm ~/.hertzflow/keystore.legacy.json                    # only after verifying `hz wallet show`
```

Set `HZ_SUPPRESS_LEGACY_WARN=1` to silence the warning if you cannot migrate yet.

### `HZ_PRIVATE_KEY` warnings

Setting the env var skips all encryption. The raw key may leak via:

- shell history (`.bash_history`, etc.) — always use `export HZ_PRIVATE_KEY=...` from a script file with mode `0600`, never inline
- process listings (`ps -E`, `/proc/<pid>/environ`)
- CI logs (set as a masked secret)
- core dumps and crash reports
- Node.js heap snapshots if you run a debugger

Use it for testnet automation only. For mainnet, prefer the keystore.

---

## Security

This CLI has been audited internally. Notable hardening:

- **Slippage protection**: every market order computes `acceptablePrice` from the live oracle price ± `--slippage` bps. Orders without a resolvable mark price are refused.
- **Strict symbol matching**: `BTC` does not match `BTCB`. Ambiguous symbols throw with the candidate list.
- **Interactive y/N confirmation** before any signing operation in `trade long/short/close`. Aborts on `n` / empty / EOF. Bypass with `HZ_YES=1`.
- **TX receipt confirmation**: `approve` and `multicall` both wait for receipt and abort the next step if reverted.
- **No private key on argv**: `wallet import` and password prompts use raw-mode stdin so nothing lands in shell history or `ps`.
- **Mainnet locked**: `getNetworkConfig('mainnet')` throws until the deployed addresses are populated.
- **Min collateral / max leverage** validated client-side before signing.
- **Single-source ABIs** extracted from `testnet.hertzflow.xyz` JS bundles — committed verbatim, no runtime fetch.

### Known limitations

- Uses viem's default public RPC for BSC testnet — rate-limited and occasionally flaky. Set a private RPC by extending `src/config.ts` (`NetworkConfig.rpcUrl`).
- Only market orders are wired up; the underlying ABI supports limit / stop / TP / SL but the CLI does not yet expose them.
- Execution fee is hard-coded to `0.001 BNB`. If keepers stop executing your orders during a gas spike, raise it via a code edit (TODO: `--exec-fee` flag).
- No automated tests yet. The audit was static + smoke testing on testnet.
- The keystore format is not interoperable with other Ethereum wallets — see above.

---

## Architecture

```
src/
├── index.ts                 # commander entry, registers all subcommands
├── config.ts                # network configs (testnet contracts, API URLs)
├── client.ts                # viem public + wallet clients
├── wallet.ts                # keystore (PBKDF2 + AES-CTR + HMAC), env var fallback
├── abi/
│   ├── exchange-router.ts   # extracted from testnet.hertzflow.xyz
│   ├── reader.ts
│   └── erc20.ts
├── commands/
│   ├── wallet-cmd.ts        # create / import / export / show
│   ├── price.ts             # GET /api/v1/latestPrice
│   ├── kline.ts             # GET /api/v1/historyKLines
│   ├── market.ts            # SyntheticsReader.getMarkets
│   ├── position.ts          # SyntheticsReader.getAccountPositions
│   ├── order.ts             # getAccountOrders + ExchangeRouter.cancelOrder
│   └── trade.ts             # multicall(sendWnt + sendTokens + createOrder)
└── utils/format.ts          # JSON / table output, USD/token formatting
```

Trade flow follows the standard GMX v2 pattern:

```
approve(USDT → SyntheticsRouter, collateral)   ←  wait for receipt
        ↓
multicall:
  ├─ sendWnt(orderVault, executionFee)
  ├─ sendTokens(USDT, orderVault, collateral)   (open only)
  └─ createOrder(CreateOrderParams)
        ↓                                        ←  wait for receipt
keeper picks up the order off-chain and executes against the oracle price
```

---

## Contributing

PRs welcome. Before submitting:

```bash
npm run build       # must compile clean
node dist/index.js price   # must return live data
```

Open issues for: limit / TP / SL commands, pool / vault commands, dynamic execution fee, RPC config, npm publish.

---

## License

TBD
