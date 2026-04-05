import { type Chain } from 'viem';
import { bscTestnet, bsc } from 'viem/chains';

export type NetworkName = 'testnet' | 'mainnet';

export interface NetworkConfig {
  chain: Chain;
  contracts: {
    exchangeRouter: `0x${string}`;
    syntheticsReader: `0x${string}`;
    dataStore: `0x${string}`;
    depositVault: `0x${string}`;
    withdrawalVault: `0x${string}`;
    orderVault: `0x${string}`;
    shiftVault: `0x${string}`;
    subaccountRouter: `0x${string}`;
    syntheticsRouter: `0x${string}`;
    eventEmitter: `0x${string}`;
    multicall: `0x${string}`;
    referralStorage: `0x${string}`;
    claimHandler: `0x${string}`;
    externalHandler: `0x${string}`;
  };
  api: {
    klineBaseUrl: string;
    oracleBaseUrl: string;
    statsBaseUrl: string;
  };
  rpcUrl?: string;
}

const TESTNET_CONFIG: NetworkConfig = {
  chain: bscTestnet,
  contracts: {
    exchangeRouter: '0xe2115D5E878cD1990a012857284CC5e1d841e221',
    syntheticsReader: '0x1B99dE20448c4fa830954C66CA938A1d1A78C283',
    dataStore: '0x61d4746598170E8ec96f90135307e329bcb3c244',
    depositVault: '0xcFe85354cfA01FD0D39b463Ef582987fDE499696',
    withdrawalVault: '0x3028e45D108F78eB5531E6C5CFaf7431064A7eE8',
    orderVault: '0xf6ada7B38267b10ad77cdeF8e301F5331e346E6D',
    shiftVault: '0xC2C3507D8b0D98FD35309C8A4465C747fB662f25',
    subaccountRouter: '0xE358DE1F2bf4B53E2E6E40dA7e5f110CB4E9D04C',
    syntheticsRouter: '0xC5Edd32B27c507cdbd82dF58610caD7a0B583C07',
    eventEmitter: '0x392F204E5Fd7A2C9f6393752985FD04Adae95c10',
    multicall: '0x2AF285822118B8054DEbA36cc80967E9167f914a',
    referralStorage: '0xf3EaadCfb05d9f971BD93590790BBE01c29DE9Ff',
    claimHandler: '0x79026751897Ebd2312B06F4DA54818a41E2e706c',
    externalHandler: '0xb4B92a6A6845fC95e7F91c2041eBCED4E78E3802',
  },
  api: {
    klineBaseUrl: 'https://kline-query.testnet.htzfl.link',
    oracleBaseUrl: 'https://oracle-aggregator.testnet.htzfl.link',
    statsBaseUrl: 'https://data-statistics-query.testnet.htzfl.link',
  },
};

const MAINNET_CONFIG: NetworkConfig = {
  chain: bsc,
  contracts: {
    // Mainnet addresses TBD
    exchangeRouter: '0x0000000000000000000000000000000000000000',
    syntheticsReader: '0x0000000000000000000000000000000000000000',
    dataStore: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000',
    withdrawalVault: '0x0000000000000000000000000000000000000000',
    orderVault: '0x0000000000000000000000000000000000000000',
    shiftVault: '0x0000000000000000000000000000000000000000',
    subaccountRouter: '0x0000000000000000000000000000000000000000',
    syntheticsRouter: '0x0000000000000000000000000000000000000000',
    eventEmitter: '0x0000000000000000000000000000000000000000',
    multicall: '0x0000000000000000000000000000000000000000',
    referralStorage: '0x0000000000000000000000000000000000000000',
    claimHandler: '0x0000000000000000000000000000000000000000',
    externalHandler: '0x0000000000000000000000000000000000000000',
  },
  api: {
    klineBaseUrl: '',
    oracleBaseUrl: '',
    statsBaseUrl: '',
  },
};

export function getNetworkConfig(network: NetworkName): NetworkConfig {
  if (network === 'mainnet') {
    throw new Error('Mainnet is not yet supported. Use --network testnet.');
  }
  if (network !== 'testnet') {
    throw new Error(`Unknown network "${network}". Valid: testnet, mainnet.`);
  }
  return TESTNET_CONFIG;
}

export const DEFAULT_NETWORK: NetworkName = 'testnet';
