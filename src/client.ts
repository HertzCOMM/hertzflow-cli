import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { type NetworkConfig } from './config.js';

export function createReader(config: NetworkConfig): PublicClient {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

export function createWriter(
  config: NetworkConfig,
  account: Account,
): WalletClient {
  return createWalletClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
    account,
  });
}
