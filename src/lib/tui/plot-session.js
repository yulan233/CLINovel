export function createPlotSession(options, selectedIndex = 0) {
  const items = Array.isArray(options)
    ? options
        .filter((item) => item?.id)
        .map((item, index) => ({
          index,
          shortId: String(index + 1),
          optionId: item.id
        }))
    : [];

  if (!items.length) {
    return null;
  }

  return {
    items,
    selectedIndex: clampPlotIndex(selectedIndex, items.length),
    mode: "quick-actions"
  };
}

export function clampPlotIndex(index, length) {
  if (!length) {
    return 0;
  }
  return Math.min(Math.max(0, index || 0), length - 1);
}

export function movePlotSelection(session, step) {
  if (!session?.items?.length) {
    return session || null;
  }

  return {
    ...session,
    selectedIndex: clampPlotIndex((session.selectedIndex || 0) + step, session.items.length)
  };
}

export function getSelectedPlotAction(session, plotState) {
  if (!session?.items?.length) {
    return null;
  }

  const current = session.items[session.selectedIndex || 0];
  const option = (plotState?.options || []).find((item) => item.id === current.optionId);
  if (!option) {
    return null;
  }

  return {
    shortId: current.shortId,
    optionId: current.optionId,
    option
  };
}

export function syncPlotSession(session, plotState) {
  if (!session?.items?.length) {
    return null;
  }

  const availableIds = new Set((plotState?.options || []).map((item) => item.id));
  const items = session.items.filter((item) => availableIds.has(item.optionId));
  if (!items.length) {
    return null;
  }

  return {
    ...session,
    items: items.map((item, index) => ({
      ...item,
      index,
      shortId: String(index + 1)
    })),
    selectedIndex: clampPlotIndex(session.selectedIndex, items.length)
  };
}
