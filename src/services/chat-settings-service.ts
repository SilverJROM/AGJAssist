import { DatabaseService } from "../db/database.js";

export interface ChatSetting {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

export class ChatSettingsService {
  constructor(private readonly db: DatabaseService) {}

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM chat_settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO chat_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      )
      .run(key, value);
  }

  getAll(): ChatSetting[] {
    return this.db
      .prepare("SELECT * FROM chat_settings ORDER BY key")
      .all() as ChatSetting[];
  }

  delete(key: string): boolean {
    const result = this.db
      .prepare("DELETE FROM chat_settings WHERE key = ?")
      .run(key);
    return result.changes > 0;
  }
}
