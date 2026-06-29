import { logger } from "../utils/logger.js";

export interface ChainConfig {
  id: string;
  name: string;
  type: "evm" | "solana" | "hyperliquid";
  rpcUrl: string;
  nativeSymbol: string;
}

/**
 * Dynamic Multi-Chain & Exchange Provider Registry.
 * Centralized, dynamic registry for resolving RPC nodes and validator APIs
 * without hardcoding URLs inside feature modules.
 */
export class ChainRegistry {
  private chains: Map<string, ChainConfig> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.register({ id: "ethereum", name: "Ethereum Mainnet", type: "evm", rpcUrl: "https://cloudflare-eth.com", nativeSymbol: "ETH" });
    this.register({ id: "arbitrum", name: "Arbitrum One", type: "evm", rpcUrl: "https://arb1.arbitrum.io/rpc", nativeSymbol: "ETH" });
    this.register({ id: "base", name: "Base Mainnet", type: "evm", rpcUrl: "https://mainnet.base.org", nativeSymbol: "ETH" });
    this.register({ id: "solana", name: "Solana Mainnet-Beta", type: "solana", rpcUrl: "https://api.mainnet-beta.solana.com", nativeSymbol: "SOL" });
    this.register({ id: "hyperliquid", name: "Hyperliquid L1", type: "hyperliquid", rpcUrl: "https://api.hyperliquid.xyz/info", nativeSymbol: "HYPE" });
  }

  register(config: ChainConfig): void {
    this.chains.set(config.id, config);
    logger.info({ chainId: config.id, rpcUrl: config.rpcUrl }, "[ChainRegistry] Dynamic chain RPC registered");
  }

  getChain(id: string): ChainConfig | undefined {
    return this.chains.get(id);
  }

  getAllChains(): ChainConfig[] {
    return Array.from(this.chains.values());
  }
}

let _chainRegistry: ChainRegistry | null = null;
export function getChainRegistry(): ChainRegistry {
  if (!_chainRegistry) _chainRegistry = new ChainRegistry();
  return _chainRegistry;
}
