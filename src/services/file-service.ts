import fs from "node:fs";
import path from "node:path";

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

export interface FileContent {
  content: string;
  size: number;
  language: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", ".cache", "coverage"
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".sqlite", ".db", ".sqlite3"
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescriptreact",
  ".js": "javascript", ".jsx": "javascriptreact",
  ".json": "json", ".jsonc": "jsonc",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "scss", ".less": "less",
  ".md": "markdown", ".mdx": "markdown",
  ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
  ".java": "java", ".kt": "kotlin", ".scala": "scala",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".sql": "sql", ".graphql": "graphql", ".gql": "graphql",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".xml": "xml", ".svg": "xml",
  ".dockerfile": "dockerfile",
  ".env": "plaintext", ".gitignore": "plaintext",
  ".vue": "vue", ".svelte": "svelte"
};

export class FileService {
  private safePath(projectRoot: string, relativePath: string): string {
    const cleaned = (relativePath || "").replace(/\\/g, "/");
    const resolved = path.resolve(projectRoot, cleaned);
    const normalizedRoot = path.resolve(projectRoot);

    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
      throw new PathTraversalError("Path escapes project root");
    }

    // Check for symlink escape
    try {
      const real = fs.realpathSync(resolved);
      if (!real.startsWith(normalizedRoot + path.sep) && real !== normalizedRoot) {
        throw new PathTraversalError("Symlink escapes project root");
      }
    } catch (e) {
      if (e instanceof PathTraversalError) throw e;
      // File may not exist yet (for create operations) - check parent
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        if (!realParent.startsWith(normalizedRoot + path.sep) && realParent !== normalizedRoot) {
          throw new PathTraversalError("Parent symlink escapes project root");
        }
      }
    }

    return resolved;
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (EXTENSION_LANGUAGE_MAP[ext]) return EXTENSION_LANGUAGE_MAP[ext];

    const basename = path.basename(filePath).toLowerCase();
    if (basename === "dockerfile") return "dockerfile";
    if (basename === "makefile") return "makefile";
    if (basename === ".gitignore" || basename === ".dockerignore") return "plaintext";

    return "plaintext";
  }

  private isBinary(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  listDirectory(projectRoot: string, relativePath: string): FileEntry[] {
    const fullPath = this.safePath(projectRoot, relativePath || ".");

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      throw new FileNotFoundError("Directory not found");
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) && entry.isDirectory()) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore" && entry.isDirectory()) continue;

      try {
        const entryPath = path.join(fullPath, entry.name);
        const stat = fs.statSync(entryPath);
        result.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: stat.size,
          modified: stat.mtime.toISOString()
        });
      } catch {
        // Skip entries we can't stat (broken symlinks, permission errors)
      }
    }

    // Sort: directories first, then alphabetical
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  readFile(projectRoot: string, relativePath: string): FileContent {
    const fullPath = this.safePath(projectRoot, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new FileNotFoundError("File not found");
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new FileNotFoundError("Path is a directory");
    }

    if (stat.size > MAX_FILE_SIZE) {
      throw new FileTooLargeError(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }

    if (this.isBinary(fullPath)) {
      throw new BinaryFileError("Binary file cannot be displayed as text");
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    return {
      content,
      size: stat.size,
      language: this.detectLanguage(fullPath)
    };
  }

  writeFile(projectRoot: string, relativePath: string, content: string): void {
    const fullPath = this.safePath(projectRoot, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new FileNotFoundError("File not found");
    }

    if (!fs.statSync(fullPath).isFile()) {
      throw new FileNotFoundError("Path is not a file");
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  writeBinaryFile(projectRoot: string, relativePath: string, data: Buffer): void {
    const fullPath = this.safePath(projectRoot, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  createFile(projectRoot: string, relativePath: string, content = ""): void {
    const fullPath = this.safePath(projectRoot, relativePath);

    if (fs.existsSync(fullPath)) {
      throw new FileExistsError("Path already exists");
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
  }

  createDirectory(projectRoot: string, relativePath: string): void {
    const fullPath = this.safePath(projectRoot, relativePath);

    if (fs.existsSync(fullPath)) {
      throw new FileExistsError("Path already exists");
    }

    fs.mkdirSync(fullPath, { recursive: true });
  }

  deleteEntry(projectRoot: string, relativePath: string): void {
    const fullPath = this.safePath(projectRoot, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new FileNotFoundError("Path not found");
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
  }

  renameEntry(projectRoot: string, oldPath: string, newPath: string): void {
    const fullOld = this.safePath(projectRoot, oldPath);
    const fullNew = this.safePath(projectRoot, newPath);

    if (!fs.existsSync(fullOld)) {
      throw new FileNotFoundError("Source path not found");
    }

    if (fs.existsSync(fullNew)) {
      throw new FileExistsError("Destination already exists");
    }

    const destDir = path.dirname(fullNew);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(fullOld, fullNew);
  }

  copyEntry(projectRoot: string, srcPath: string, destPath: string): void {
    const fullSrc = this.safePath(projectRoot, srcPath);
    const fullDest = this.safePath(projectRoot, destPath);

    if (!fs.existsSync(fullSrc)) {
      throw new FileNotFoundError("Source path not found");
    }

    if (fs.existsSync(fullDest)) {
      throw new FileExistsError("Destination already exists");
    }

    const destDir = path.dirname(fullDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.statSync(fullSrc).isDirectory()) {
      fs.cpSync(fullSrc, fullDest, { recursive: true });
    } else {
      fs.copyFileSync(fullSrc, fullDest);
    }
  }

  searchFiles(projectRoot: string, query: string, maxResults = 20): string[] {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = (dir: string, relativeBase: string) => {
      if (results.length >= maxResults) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) return;

        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.isDirectory()) continue;

        const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relativePath);
        } else if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push(relativePath);
        }
      }
    };

    walk(projectRoot, "");
    return results;
  }
}

export class PathTraversalError extends Error {
  constructor(message: string) { super(message); this.name = "PathTraversalError"; }
}

export class FileNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "FileNotFoundError"; }
}

export class FileTooLargeError extends Error {
  constructor(message: string) { super(message); this.name = "FileTooLargeError"; }
}

export class BinaryFileError extends Error {
  constructor(message: string) { super(message); this.name = "BinaryFileError"; }
}

export class FileExistsError extends Error {
  constructor(message: string) { super(message); this.name = "FileExistsError"; }
}
