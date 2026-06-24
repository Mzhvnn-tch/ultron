import { describe, it, expect } from "vitest";
import { getValidityEngine } from "./validity.js";

describe("ValidityEngine", () => {
  it("should decompose queries into sub-queries using fallback heuristics", async () => {
    const engine = getValidityEngine();
    const result = await engine.decomposeDense("Why is ETH staking yield changing?");
    
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].query).toContain("ETH staking yield");
    expect(result[0].expectedType).toBe("causation");
  });
});
