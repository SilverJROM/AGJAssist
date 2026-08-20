import { describe, expect, it } from "vitest";
import {
  ATTACH_IMAGE_MAX_BYTES,
  decodeAttachImageBase64,
  sanitizeAttachImageBasename
} from "../src/tmux/tmux-image-helpers.js";

describe("tmux-image-helpers (B18 extract, attach-image identical)", () => {
  it("sanitizes basenames and rejects non-image / empty names", () => {
    expect(sanitizeAttachImageBasename("shot.png")).toBe("shot.png");
    expect(sanitizeAttachImageBasename("../../etc/x.png")).toBe("x.png");
    expect(sanitizeAttachImageBasename("nope.txt")).toBeNull();
    expect(sanitizeAttachImageBasename("")).toBeNull();
  });

  it("decodes data-URL or raw base64 and keeps the 10MB constant", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    expect(decodeAttachImageBase64(png.toString("base64"))).toEqual(png);
    expect(
      decodeAttachImageBase64(`data:image/png;base64,${png.toString("base64")}`)
    ).toEqual(png);
    expect(decodeAttachImageBase64("%%%")).toBeNull();
    expect(ATTACH_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
