import fs from "node:fs";
import path from "node:path";
import { DatabaseService } from "../db/database.js";

export interface Project {
  id: number;
  directory_name: string;
  display_name: string | null;
  status: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithCounts extends Project {
  tmux_session_count: number;
  open_notes_count: number;
  active_plans_count: number;
  pending_tasks_count: number;
}

export class ProjectService {
  constructor(
    private readonly db: DatabaseService,
    private readonly projectsRoot: string
  ) {}

  scanAndSync(): number {
    if (!fs.existsSync(this.projectsRoot)) return 0;

    const entries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO projects (directory_name) VALUES (?)"
    );

    let added = 0;
    this.db.transaction(() => {
      for (const dir of dirs) {
        const result = insert.run(dir);
        if (result.changes > 0) added++;
      }
    });

    return added;
  }

  list(includeArchived = false): ProjectWithCounts[] {
    const statusFilter = includeArchived ? "" : "WHERE p.status = 'active'";

    return this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM tmux_sessions ts WHERE ts.project_id = p.id AND ts.status = 'active') as tmux_session_count,
          (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.status = 'open') as open_notes_count,
          (SELECT COUNT(*) FROM plans pl WHERE pl.project_id = p.id AND pl.status = 'active') as active_plans_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'pending') as pending_tasks_count
        FROM projects p ${statusFilter}
        ORDER BY p.directory_name`
      )
      .all() as ProjectWithCounts[];
  }

  getById(id: number): ProjectWithCounts | null {
    return this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM tmux_sessions ts WHERE ts.project_id = p.id AND ts.status = 'active') as tmux_session_count,
          (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.status = 'open') as open_notes_count,
          (SELECT COUNT(*) FROM plans pl WHERE pl.project_id = p.id AND pl.status = 'active') as active_plans_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'pending') as pending_tasks_count
        FROM projects p WHERE p.id = ?`
      )
      .get(id) as ProjectWithCounts | null;
  }

  getByName(name: string): Project | null {
    return this.db
      .prepare("SELECT * FROM projects WHERE directory_name = ?")
      .get(name) as Project | null;
  }

  update(
    id: number,
    updates: { display_name?: string | null; status?: "active" | "archived"; active?: number }
  ): Project | null {
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as Project | undefined;

    if (!existing) return null;

    const displayName =
      updates.display_name !== undefined ? updates.display_name : existing.display_name;
    const status = updates.status ?? existing.status;
    const active = updates.active !== undefined ? updates.active : existing.active;

    this.db
      .prepare(
        "UPDATE projects SET display_name = ?, status = ?, active = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(displayName, status, active, id);

    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
  }

  getFullPath(project: Project): string {
    return path.join(this.projectsRoot, project.directory_name);
  }
}
