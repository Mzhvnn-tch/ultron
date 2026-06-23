import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getOrchestrator } from "../pipeline/orchestrator.js";
import type {
  CapOrder,
  CapDelivery,
  AgentIdentity,
  AgentCapability,
  ResearchResult,
} from "../types.js";
import { createHash, randomUUID } from "node:crypto";

/**
 * CAP Protocol Wrapper
 *
 * Wraps the research engine as a discoverable, payable agent capability
 * via the CROO CAP (Capability Access Protocol):
 *
 *  Lifecycle: Negotiate → Lock → Deliver → Clear
 *
 * Other agents discover this agent in the Agent Store,
 * place orders via CAP, and pay automatically from their wallet.
 */
export class CapWrapper {
  private identity: AgentIdentity;
  private activeOrders: Map<string, CapOrder> = new Map();
  private deliveredOrders: Map<string, CapDelivery> = new Map();

  constructor() {
    this.identity = this.buildIdentity();
    logger.info(
      {
        did: this.identity.did,
        capabilities: this.identity.capabilities.length,
      },
      "[CAP] Agent identity created"
    );
  }

  getIdentity(): AgentIdentity {
    return this.identity;
  }

  /**
   * Register this agent on the CAP Registry (Agent Store).
   */
  async register(): Promise<boolean> {
    if (!config.cap.enabled) {
      logger.info("[CAP] CAP is disabled — skipping registration");
      return false;
    }

    try {
      const resp = await fetch(`${config.cap.registryUrl}/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.identity),
      });

      if (resp.ok) {
        logger.info("[CAP] Agent registered on CAP Registry");
        return true;
      } else {
        logger.warn({ status: resp.status }, "[CAP] Registration failed");
        return false;
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "[CAP] Registry unreachable — will retry");
      return false;
    }
  }

  /**
   * Handle incoming order from another agent.
   *
   * CAP Lifecycle:
   *  1. Negotiate — buyer proposes terms, seller accepts/rejects
   *  2. Lock — funds locked in escrow, seller commits to deliver
   *  3. Deliver — seller delivers result + proof
   *  4. Clear — buyer verifies, funds released to seller
   */
  async handleOrder(order: CapOrder): Promise<CapDelivery | null> {
    logger.info(
      { orderId: order.orderId, buyer: order.buyerDid },
      "[CAP] Order received"
    );

    // Step 1: Negotiate — validate the order
    if (order.status !== "negotiate") {
      logger.warn({ orderId: order.orderId, status: order.status }, "[CAP] Unexpected order status");
      return null;
    }

    const capability = this.identity.capabilities.find(
      (c) => c.id === order.capabilityId
    );
    if (!capability) {
      logger.warn({ capabilityId: order.capabilityId }, "[CAP] Unknown capability requested");
      return null;
    }

    // Step 2: Lock — accept the order, execute research
    order.status = "locked";
    this.activeOrders.set(order.orderId, order);

    logger.info({ orderId: order.orderId }, "[CAP] Order locked — executing research");

    // Execute the research
    const orchestrator = getOrchestrator();
    const result = await orchestrator.research(order.params);

    // Step 3: Deliver — create delivery proof
    const delivery = this.createDelivery(order, result);
    this.deliveredOrders.set(order.orderId, delivery);
    order.status = "delivered";

    logger.info(
      { orderId: order.orderId, durationMs: result.durationMs },
      "[CAP] Research delivered"
    );

    // Step 4: Clear — submit delivery to CAP
    await this.submitDelivery(delivery);
    order.status = "cleared";
    this.activeOrders.delete(order.orderId);

    return delivery;
  }

  /**
   * Create a cryptographically verifiable delivery proof.
   */
  private createDelivery(order: CapOrder, result: ResearchResult): CapDelivery {
    const resultJson = JSON.stringify(result);
    const resultHash = createHash("sha256").update(resultJson).digest("hex");

    // In production, this would be an actual ECDSA signature
    // using the agent's private key
    const signature = createHash("sha256")
      .update(`${order.orderId}:${resultHash}:${Date.now()}`)
      .digest("hex");

    return {
      orderId: order.orderId,
      resultHash,
      resultUri: `ipfs://pending-upload/${resultHash}`, // Would upload to IPFS in production
      proof: {
        timestamp: Date.now(),
        agentDid: this.identity.did,
        signature,
      },
    };
  }

  /**
   * Submit delivery proof to CAP for settlement.
   */
  private async submitDelivery(delivery: CapDelivery): Promise<void> {
    if (!config.cap.enabled) return;

    try {
      await fetch(`${config.cap.registryUrl}/orders/${delivery.orderId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(delivery),
      });
      logger.info({ orderId: delivery.orderId }, "[CAP] Delivery submitted");
    } catch (err: any) {
      logger.warn({ error: err.message }, "[CAP] Delivery submission failed");
    }
  }

  /**
   * Get order status.
   */
  getOrderStatus(orderId: string): CapOrder | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * List all active and recent orders.
   */
  listOrders(): { active: CapOrder[]; delivered: CapDelivery[] } {
    return {
      active: [...this.activeOrders.values()],
      delivered: [...this.deliveredOrders.values()],
    };
  }

  /**
   * Build agent identity from config.
   */
  private buildIdentity(): AgentIdentity {
    const walletAddress =
      config.cap.agentPrivateKey
        ? this.deriveAddress(config.cap.agentPrivateKey)
        : "0x0000000000000000000000000000000000000000";

    const did = `did:croo:${walletAddress.toLowerCase()}`;

    const capabilities: AgentCapability[] = [
      {
        id: "research.deep",
        name: "Deep Research",
        description:
          "Autonomous multi-source research with API-first discovery, network sniffing, stealth scraping, and citation grounding. Returns structured findings with verifiable sources.",
        price: "1000000000000000", // 0.001 ETH equivalent
        token: "ETH",
        maxInputLength: 1000,
        estimatedDuration: 30000,
      },
      {
        id: "research.quick",
        name: "Quick Research",
        description:
          "Faster research mode with fewer sources and shallower depth. Good for simple fact-finding.",
        price: "500000000000000", // 0.0005 ETH equivalent
        token: "ETH",
        maxInputLength: 500,
        estimatedDuration: 15000,
      },
    ];

    return {
      did,
      walletAddress,
      publicKey: `0x${createHash("sha256").update(walletAddress).digest("hex").substring(0, 64)}`,
      capabilities,
      registeredAt: Date.now(),
    };
  }

  /**
   * Derive wallet address from private key (simplified — in production use ethers.js).
   */
  private deriveAddress(privateKey: string): string {
    if (privateKey === "0x" || !privateKey) {
      return "0x" + createHash("sha256").update(randomUUID()).digest("hex").substring(0, 40);
    }
    return "0x" + createHash("sha256").update(privateKey).digest("hex").substring(0, 40);
  }
}

// Singleton
let _capWrapper: CapWrapper | null = null;
export function getCapWrapper(): CapWrapper {
  if (!_capWrapper) _capWrapper = new CapWrapper();
  return _capWrapper;
}
