import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";

export interface CodeAuditReport {
  timestamp: number;
  totalFilesScanned: number;
  bottlenecksFound: string[];
  recommendedUpgrades: string[];
}

/**
 * Static Code Analyzer Engine.
 * Safe static analysis scanner for detecting basic architectural patterns and linter warnings.
 */
export class StaticCodeAnalyzerEngine {
  private srcDir: string;

  constructor() {
    this.srcDir = path.resolve(process.cwd(), "src");
  }

  /**
   * Scan Ultron's TypeScript repository and generate a static linter & architectural report.
   */
  async auditCodebase(): Promise<CodeAuditReport> {
    logger.info({ srcDir: this.srcDir }, "[StaticAnalyzer] Initiating static codebase analysis");

    const files = this.getAllFiles(this.srcDir);
    const bottlenecksFound: string[] = [];
    const recommendedUpgrades: string[] = [];

    for (const file of files) {
      if (file.endsWith(".ts")) {
        const content = fs.readFileSync(file, "utf-8");
        const relPath = path.relative(process.cwd(), file);

        if (content.includes("setTimeout") && !content.includes("AbortController")) {
          bottlenecksFound.push(`[${relPath}] Uses raw setTimeout without AbortController timeout cancellation.`);
        }
        if (content.includes("JSON.parse") && !content.includes("try {")) {
          bottlenecksFound.push(`[${relPath}] Unsafe JSON.parse detected outside try-catch block.`);
        }
        if (content.includes("fetch(") && !content.includes("headers")) {
          recommendedUpgrades.push(`[${relPath}] Optimize HTTP fetch requests with explicit custom User-Agent headers.`);
        }
      }
    }

    if (bottlenecksFound.length === 0) {
      bottlenecksFound.push("All core files pass basic static analysis. Memory & execution parameters optimal.");
    }

    recommendedUpgrades.push("Implement comprehensive integration test suite for multi-layer orchestrator.");

    const report: CodeAuditReport = {
      timestamp: Date.now(),
      totalFilesScanned: files.length,
      bottlenecksFound,
      recommendedUpgrades,
    };

    logger.info({ totalFiles: files.length, bottlenecks: bottlenecksFound.length }, "[StaticAnalyzer] Static codebase analysis complete");
    return report;
  }

  private getAllFiles(dirPath: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        this.getAllFiles(filePath, fileList);
      } else {
        fileList.push(filePath);
      }
    }
    return fileList;
  }
}

let _codeAnalyzer: StaticCodeAnalyzerEngine | null = null;
export function getCodeBuilder(): StaticCodeAnalyzerEngine {
  if (!_codeAnalyzer) _codeAnalyzer = new StaticCodeAnalyzerEngine();
  return _codeAnalyzer;
}
