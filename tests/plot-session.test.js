import test from "node:test";
import assert from "node:assert/strict";
import { createPlotSession, getSelectedPlotAction, movePlotSelection, syncPlotSession } from "../src/lib/tui/plot-session.js";

test("createPlotSession builds short ids for the latest plot group", () => {
  const session = createPlotSession([{ id: "plot-a" }, { id: "plot-b" }, { id: "plot-c" }]);

  assert.equal(session.items.length, 3);
  assert.equal(session.items[0].shortId, "1");
  assert.equal(session.items[2].optionId, "plot-c");
});

test("movePlotSelection clamps within the current plot group", () => {
  const session = createPlotSession([{ id: "plot-a" }, { id: "plot-b" }], 0);

  assert.equal(movePlotSelection(session, -1).selectedIndex, 0);
  assert.equal(movePlotSelection(session, 1).selectedIndex, 1);
  assert.equal(movePlotSelection(session, 5).selectedIndex, 1);
});

test("getSelectedPlotAction resolves the short selection to the real plot id", () => {
  const session = createPlotSession([{ id: "plot-a" }, { id: "plot-b" }], 1);
  const selected = getSelectedPlotAction(session, {
    options: [
      { id: "plot-a", title: "A" },
      { id: "plot-b", title: "B", status: "suggested" }
    ]
  });

  assert.equal(selected.shortId, "2");
  assert.equal(selected.optionId, "plot-b");
  assert.equal(selected.option.title, "B");
});

test("syncPlotSession drops missing plot options and renumbers short ids", () => {
  const session = createPlotSession([{ id: "plot-a" }, { id: "plot-b" }, { id: "plot-c" }], 2);
  const synced = syncPlotSession(session, {
    options: [{ id: "plot-b" }, { id: "plot-c" }]
  });

  assert.equal(synced.items.length, 2);
  assert.equal(synced.items[0].shortId, "1");
  assert.equal(synced.selectedIndex, 1);
});
