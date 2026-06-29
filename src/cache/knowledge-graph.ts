import Database from "better-sqlite3";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { KnowledgeEntity, KnowledgeTriple, VectorMemoryItem } from "../types.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Long-Term Dynamic Knowledge Graph & Vector Memory Store.
 * Managed via SQLite (better-sqlite3) with WAL mode for performance optimization on 2GB VPS environments.
 */
export class KnowledgeGraphStore {
  private db: Database.Database;
  private insertEntityStmt: Database.Statement;
  private insertTripleStmt: Database.Statement;
  private insertVectorStmt: Database.Statement;
  private getEntityByNameStmt: Database.Statement;
  private getTriplesForEntityStmt: Database.Statement;

  constructor() {
    const dbPath = config.cache.dbPath.replace("endpoints.db", "knowledge_graph.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        description TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entities_name ON knowledge_entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON knowledge_entities(type);

      CREATE TABLE IF NOT EXISTS knowledge_triples (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        source_query TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(subject_id) REFERENCES knowledge_entities(id),
        FOREIGN KEY(object_id) REFERENCES knowledge_entities(id)
      );
      CREATE INDEX IF NOT EXISTS idx_triples_sub ON knowledge_triples(subject_id);
      CREATE INDEX IF NOT EXISTS idx_triples_obj ON knowledge_triples(object_id);
      CREATE INDEX IF NOT EXISTS idx_triples_pred ON knowledge_triples(predicate);

      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        id TEXT PRIMARY KEY,
        claim TEXT NOT NULL,
        vector TEXT NOT NULL,
        entity_ids TEXT NOT NULL,
        source_url TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    this.insertEntityStmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_entities (id, name, type, description, metadata, created_at, updated_at)
      VALUES (@id, @name, @type, @description, @metadata, @createdAt, @updatedAt)
    `);

    this.insertTripleStmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_triples (id, subject_id, predicate, object_id, confidence, source_query, created_at)
      VALUES (@id, @subjectId, @predicate, @objectId, @confidence, @sourceQuery, @createdAt)
    `);

    this.insertVectorStmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_vectors (id, claim, vector, entity_ids, source_url, created_at)
      VALUES (@id, @claim, @vector, @entityIds, @sourceUrl, @createdAt)
    `);

    this.getEntityByNameStmt = this.db.prepare(`SELECT * FROM knowledge_entities WHERE name = ?`);
    this.getTriplesForEntityStmt = this.db.prepare(`
      SELECT t.*, s.name as subject_name, o.name as object_name 
      FROM knowledge_triples t
      JOIN knowledge_entities s ON t.subject_id = s.id
      JOIN knowledge_entities o ON t.object_id = o.id
      WHERE t.subject_id = ? OR t.object_id = ?
    `);

    logger.info({ dbPath }, "[KnowledgeGraph] Store initialized");
  }

  /** Save or update an Entity */
  saveEntity(entity: KnowledgeEntity): void {
    this.insertEntityStmt.run({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      description: entity.description || null,
      metadata: entity.metadata ? JSON.stringify(entity.metadata) : null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  /** Save a Knowledge Triple (Subject - Predicate - Object) */
  saveTriple(triple: KnowledgeTriple): void {
    this.insertTripleStmt.run({
      id: triple.id,
      subjectId: triple.subjectId,
      predicate: triple.predicate,
      objectId: triple.objectId,
      confidence: triple.confidence,
      sourceQuery: triple.sourceQuery || null,
      createdAt: triple.createdAt,
    });
  }

  /** Save a Vector Memory Item */
  saveVectorItem(item: VectorMemoryItem): void {
    this.insertVectorStmt.run({
      id: item.id,
      claim: item.claim,
      vector: JSON.stringify(item.vector),
      entityIds: JSON.stringify(item.entityIds),
      sourceUrl: item.sourceUrl || null,
      createdAt: item.createdAt,
    });
  }

  private parseJsonSafe<T>(jsonStr: string | null | undefined): T | undefined {
    if (!jsonStr) return undefined;
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      return undefined;
    }
  }

  /** Get Entity by Name */
  getEntityByName(name: string): KnowledgeEntity | null {
    const row = this.getEntityByNameStmt.get(name) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description || undefined,
      metadata: this.parseJsonSafe(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Get related triples for an entity */
  getRelatedTriples(entityId: string): Array<KnowledgeTriple & { subjectName: string; objectName: string }> {
    const rows = this.getTriplesForEntityStmt.all(entityId, entityId) as any[];
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subject_id,
      predicate: r.predicate,
      objectId: r.object_id,
      confidence: r.confidence,
      sourceQuery: r.source_query || undefined,
      createdAt: r.created_at,
      subjectName: r.subject_name,
      objectName: r.object_name,
    }));
  }

  /** Calculate Cosine Similarity between two vectors */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** Generate simple normalized term-frequency vector (32 dimensions) for offline fallback */
  static generateSimpleVector(text: string): number[] {
    const vector = new Array(32).fill(0);
    const clean = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let i = 0; i < clean.length; i++) {
      const charCode = clean.charCodeAt(i);
      const index = charCode % 32;
      vector[index] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map((val) => val / magnitude) : vector;
  }

  /** Search memory claims by vector similarity */
  searchSimilarClaims(queryText: string, topK = 5): Array<{ claim: string; score: number; sourceUrl?: string }> {
    const queryVector = KnowledgeGraphStore.generateSimpleVector(queryText);
    const rows = this.db.prepare(`SELECT * FROM knowledge_vectors`).all() as any[];

    const scored = rows.map((row) => {
      const vec = this.parseJsonSafe<number[]>(row.vector) || [];
      const score = KnowledgeGraphStore.cosineSimilarity(queryVector, vec);
      return {
        claim: row.claim as string,
        score,
        sourceUrl: row.source_url as string | undefined,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((item) => item.score > 0.3);
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let _kgStore: KnowledgeGraphStore | null = null;
export function getKnowledgeGraphStore(): KnowledgeGraphStore {
  if (!_kgStore) _kgStore = new KnowledgeGraphStore();
  return _kgStore;
}
