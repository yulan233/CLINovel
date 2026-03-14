import test from "node:test";
import assert from "node:assert/strict";
import { navigateCommandHistory, recordCommand } from "../src/lib/tui/history.js";

test("recordCommand keeps only the most recent 10 commands", () => {
  let history = [];
  for (let index = 1; index <= 12; index += 1) {
    history = recordCommand(history, `/cmd ${index}`);
  }

  assert.equal(history.length, 10);
  assert.equal(history[0], "/cmd 3");
  assert.equal(history.at(-1), "/cmd 12");
});

test("navigateCommandHistory restores the draft after moving back down", () => {
  const history = ["/outline", "/plan 001", "/write 001"];
  const firstUp = navigateCommandHistory({
    history,
    cursor: null,
    draftInput: "",
    currentInput: "/plot chapter 001",
    direction: "up"
  });
  assert.equal(firstUp.input, "/write 001");
  assert.equal(firstUp.draftInput, "/plot chapter 001");

  const secondUp = navigateCommandHistory({
    history,
    cursor: firstUp.cursor,
    draftInput: firstUp.draftInput,
    currentInput: firstUp.input,
    direction: "up"
  });
  assert.equal(secondUp.input, "/plan 001");

  const down = navigateCommandHistory({
    history,
    cursor: history.length - 1,
    draftInput: firstUp.draftInput,
    currentInput: firstUp.input,
    direction: "down"
  });
  assert.equal(down.cursor, null);
  assert.equal(down.input, "/plot chapter 001");
});
