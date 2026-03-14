export const COMMAND_HISTORY_LIMIT = 10;

export function recordCommand(history, command, limit = COMMAND_HISTORY_LIMIT) {
  const value = String(command || "").trim();
  if (!value) {
    return history || [];
  }

  return [...(history || []), value].slice(-limit);
}

export function navigateCommandHistory({ history = [], cursor = null, draftInput = "", currentInput = "", direction }) {
  if (!history.length || (direction !== "up" && direction !== "down")) {
    return {
      cursor,
      draftInput,
      input: currentInput,
      changed: false
    };
  }

  if (direction === "up") {
    if (cursor === null) {
      return {
        cursor: history.length - 1,
        draftInput: currentInput,
        input: history.at(-1),
        changed: true
      };
    }

    const nextCursor = Math.max(0, cursor - 1);
    return {
      cursor: nextCursor,
      draftInput,
      input: history[nextCursor],
      changed: nextCursor !== cursor
    };
  }

  if (cursor === null) {
    return {
      cursor,
      draftInput,
      input: currentInput,
      changed: false
    };
  }

  if (cursor >= history.length - 1) {
    return {
      cursor: null,
      draftInput: "",
      input: draftInput,
      changed: true
    };
  }

  const nextCursor = cursor + 1;
  return {
    cursor: nextCursor,
    draftInput,
    input: history[nextCursor],
    changed: true
  };
}
