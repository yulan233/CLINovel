import test from "node:test";
import assert from "node:assert/strict";
import { applyEnvText } from "../src/lib/env.js";

test("applyEnvText loads missing env vars and preserves existing ones", () => {
  delete process.env.AINOVEL_API_KEY;
  process.env.AINOVEL_MODEL = "existing-model";

  applyEnvText(
    [
      "AINOVEL_API_KEY=test-key",
      "AINOVEL_BASE_URL='https://example.com/v1'",
      "AINOVEL_MODEL=from-file"
    ].join("\n")
  );

  assert.equal(process.env.AINOVEL_API_KEY, "test-key");
  assert.equal(process.env.AINOVEL_BASE_URL, "https://example.com/v1");
  assert.equal(process.env.AINOVEL_MODEL, "existing-model");
});
