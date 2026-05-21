import { DatabaseService } from "../db/database.js";

export interface SafetyPattern {
  id: number;
  pattern: string;
  description: string | null;
  is_regex: number;
  active: number;
  created_at: string;
}

export interface SafetyCheckResult {
  blocked: boolean;
  pattern: SafetyPattern | null;
}

export class SafetyService {
  constructor(private readonly db: DatabaseService) {}

  checkCommand(command: string): SafetyCheckResult {
    const patterns = this.db
      .prepare("SELECT * FROM safety_patterns WHERE active = 1")
      .all() as SafetyPattern[];

    const lower = command.toLowerCase();

    for (const p of patterns) {
      if (p.is_regex) {
        try {
          if (new RegExp(p.pattern, "i").test(command)) {
            return { blocked: true, pattern: p };
          }
        } catch {
          // Invalid regex, skip
        }
      } else {
        if (lower.includes(p.pattern.toLowerCase())) {
          return { blocked: true, pattern: p };
        }
      }
    }

    return { blocked: false, pattern: null };
  }

  listPatterns(): SafetyPattern[] {
    return this.db.prepare("SELECT * FROM safety_patterns ORDER BY id").all() as SafetyPattern[];
  }

  addPattern(pattern: string, description: string | null, isRegex: boolean): SafetyPattern {
    const result = this.db
      .prepare(
        "INSERT INTO safety_patterns (pattern, description, is_regex) VALUES (?, ?, ?) RETURNING *"
      )
      .get(pattern, description, isRegex ? 1 : 0) as SafetyPattern;
    return result;
  }

  updatePattern(
    id: number,
    updates: { pattern?: string; description?: string | null; is_regex?: boolean; active?: boolean }
  ): SafetyPattern | null {
    const existing = this.db
      .prepare("SELECT * FROM safety_patterns WHERE id = ?")
      .get(id) as SafetyPattern | undefined;

    if (!existing) return null;

    const pattern = updates.pattern ?? existing.pattern;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const is_regex = updates.is_regex !== undefined ? (updates.is_regex ? 1 : 0) : existing.is_regex;
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : existing.active;

    this.db
      .prepare(
        "UPDATE safety_patterns SET pattern = ?, description = ?, is_regex = ?, active = ? WHERE id = ?"
      )
      .run(pattern, description, is_regex, active, id);

    return this.db
      .prepare("SELECT * FROM safety_patterns WHERE id = ?")
      .get(id) as SafetyPattern;
  }

  deletePattern(id: number): boolean {
    const result = this.db.prepare("DELETE FROM safety_patterns WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
