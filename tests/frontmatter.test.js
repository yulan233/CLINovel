import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/frontmatter.js";

test("frontmatter roundtrip preserves scalar and array fields", () => {
  const source = stringifyFrontmatter(
    {
      chapter_id: "001",
      status: "draft",
      must_include: ["目标", "冲突"]
    },
    "# body\n\nhello"
  );

  const parsed = parseFrontmatter(source);
  assert.equal(parsed.data.chapter_id, "001");
  assert.equal(parsed.data.status, "draft");
  assert.deepEqual(parsed.data.must_include, ["目标", "冲突"]);
  assert.match(parsed.content, /hello/);
});
