import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/web/public/app.js"), "utf8");

describe("terminal multi-image attachments", () => {
  it("keeps an ordered collection and accepts chooser multi-select", () => {
    expect(source).toContain("const [attachments, setAttachments] = useState([]);");
    expect(source).toContain('type="file" accept="image/*" multiple');
    expect(source).toContain("const files = Array.from(event.target.files || []);");
    expect(source).toContain("for (const file of files) await uploadAttachedImage(file);");
    expect(source).toContain("setAttachments(prev => [...prev, { path: result.path, preview: dataUrl, name }]);");
  });

  it("removes one item and sends/retries every ordered image path", () => {
    expect(source).toContain("prev.filter((_, currentIndex) => currentIndex !== index)");
    expect(source).toContain("attachments.map((item) => `[image: ${item.path}]`).join(' ')");
    expect(source).toContain("const attachmentPaths = attachments.map((item) => item.path);");
    expect(source).toContain("resendAttachmentPaths: attachmentPaths");
    expect(source).toContain("entry.resendAttachmentPaths || []");
  });
});
