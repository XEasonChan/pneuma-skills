/**
 * The launcher gallery's own surface: `showcase.json` and the PNGs it names. The launcher serves `showcase/*` straight off disk, so a
 * highlight naming a file nobody captured is a 404 on a gallery card; a capture at a Retina scale or a stray viewport lands cropped.
 * Reading the PNG header is enough to catch both (shape adapted from modes/backlot/__tests__/showcase.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHOWCASE_DIR = join(import.meta.dir, "..", "showcase");
const showcase = JSON.parse(readFileSync(join(SHOWCASE_DIR, "showcase.json"), "utf-8"));

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("showcase", () => {
  test("localized copy, three highlights", () => {
    expect(showcase.hero).toBe("hero.png");
    expect(showcase.highlights).toHaveLength(3);
    expect(Object.keys(showcase.tagline).sort()).toEqual(["en", "ja", "zh-CN"]);
    for (const h of showcase.highlights) {
      expect(Object.keys(h.title).sort()).toEqual(["en", "ja", "zh-CN"]);
      expect(Object.keys(h.description).sort()).toEqual(["en", "ja", "zh-CN"]);
      expect(h.media).toMatch(/^highlight-[\w-]+\.png$/);
      expect(h.mediaType).toBe("image");
    }
  });

  test("every named image exists at 1376 × 768", () => {
    for (const name of [showcase.hero, ...showcase.highlights.map((h: { media: string }) => h.media)]) {
      expect(pngSize(join(SHOWCASE_DIR, name))).toEqual({ width: 1376, height: 768 });
    }
  });
});
