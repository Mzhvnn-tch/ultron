import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getOrchestrator } from "../pipeline/orchestrator.js";
import type { ResearchQuery } from "../types.js";
import { AgentClient, EventType, DeliverableType } from "@croo-network/sdk";

export class CapWrapper {
  private client: AgentClient | null = null;
  private stream: any = null;
  private startTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  async initialize(): Promise<boolean> {
    if (!config.croo.enabled || !config.croo.sdkKey) {
      logger.info("[CROO] CROO CAP is disabled or missing SDK key");
      return false;
    }

    try {
      this.client = new AgentClient(
        {
          baseURL: config.croo.apiUrl,
          wsURL: config.croo.wsUrl,
        },
        config.croo.sdkKey
      );

      this.stream = await this.client.connectWebSocket();

      this.stream.on(EventType.NegotiationCreated, async (e: any) => {
        logger.info({ negotiationId: e.negotiation_id }, "[CROO] New negotiation received");
        try {
          const result = await this.client!.acceptNegotiation(e.negotiation_id!);
          logger.info({ orderId: result.order.orderId }, "[CROO] Negotiation accepted, order created");
        } catch (err: any) {
          logger.error({ error: err.message }, "[CROO] Accept negotiation failed");
        }
      });

      this.stream.on(EventType.OrderPaid, async (e: any) => {
        logger.info({ orderId: e.order_id }, "[CROO] Order paid, executing research");
        try {
          const order = await this.client!.getOrder(e.order_id!);
          const negotation = await this.client!.getNegotiation(order.negotiationId);
          const params = this.parseRequirements(negotation.requirements);

          const orchestrator = getOrchestrator();
          const result = await orchestrator.research(params);

          await this.client!.deliverOrder(e.order_id!, {
            deliverableType: DeliverableType.Text,
            deliverableText: JSON.stringify(result),
          });
          logger.info({ orderId: e.order_id }, "[CROO] Order delivered successfully");
        } catch (err: any) {
          logger.error({ error: err.message }, "[CROO] Deliver failed");
        }
      });

      this.stream.on(EventType.OrderCompleted, (e: any) => {
        logger.info({ orderId: e.order_id }, "[CROO] Order completed!");
      });

      this.stream.on(EventType.OrderRejected, (e: any) => {
        logger.warn({ orderId: e.order_id, reason: e.reason }, "[CROO] Order rejected");
      });

      logger.info(
        { apiUrl: config.croo.apiUrl },
        "[CROO] CAP initialized, listening for orders"
      );
      return true;
    } catch (err: any) {
      logger.warn({ error: err.message }, "[CROO] Failed to initialize");
      return false;
    }
  }

  private parseRequirements(req: string): ResearchQuery {
    try {
      const parsed = JSON.parse(req);
      return {
        query: parsed.query || parsed.task || "general research",
        maxDepth: parsed.maxDepth ?? 3,
        maxSources: parsed.maxSources ?? 10,
        preferApi: parsed.preferApi !== false,
        language: parsed.language || "en",
      };
    } catch {
      return {
        query: req || "general research",
        maxDepth: 3,
        maxSources: 10,
        preferApi: true,
        language: "en",
      };
    }
  }

  getIdentity() {
    return {
      did: `did:croo:agent:${config.croo.sdkKey ? config.croo.sdkKey.substring(0, 16) : 'unknown'}`,
      walletAddress: "0x0000000000000000000000000000000000000000",
      capabilities: [
        {
          id: "research.deep",
          name: "Deep Research",
          description:
            "Autonomous multi-source research with API-first discovery, network sniffing, stealth scraping, and citation grounding. Returns structured findings with verifiable sources.",
          price: "10000000000000",
          token: "ETH",
          maxInputLength: 1000,
          estimatedDuration: 30000,
        },
      ],
      registeredAt: this.startTime,
    };
  }

  async handleOrderHttp(body: any): Promise<any> {
    const orchestrator = getOrchestrator();
    const params = body.params || this.parseRequirements(body.requirements || "{}");
    const result = await orchestrator.research(params);
    return {
      orderId: body.orderId || "manual",
      result,
      deliveredAt: Date.now(),
    };
  }

  shutdown(): void {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
  }
}

let _capWrapper: CapWrapper | null = null;
export function getCapWrapper(): CapWrapper {
  if (!_capWrapper) _capWrapper = new CapWrapper();
  return _capWrapper;
}
