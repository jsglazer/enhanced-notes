export { getSelectedCollectionTreeRows, getSelectedLibraryIDs };

// Zotero 10 lets the collections list hold a multi-row selection, and the
// singular getters these replace (`getCollectionTreeRow()`,
// `getSelectedLibraryID()`, and a menu context's `collectionTreeRow`) now
// throw whenever more than one row is selected. Prefer the plural getters and
// fall back to the singular ones only on Zotero 8/9, where the plural ones
// don't exist and multi-selection isn't possible.

type TreeRow = { type: string; ref: any; id: string };

function getSelectedCollectionTreeRows(pane: any): TreeRow[] {
  if (typeof pane?.getCollectionTreeRows === "function") {
    return pane.getCollectionTreeRows().filter(Boolean);
  }
  const row = pane?.collectionsView?.selectedTreeRow;
  return row ? [row] : [];
}

function getSelectedLibraryIDs(pane: any): number[] {
  if (typeof pane?.getSelectedLibraryIDs === "function") {
    return pane.getSelectedLibraryIDs();
  }
  const libraryID = pane?.getSelectedLibraryID?.();
  return typeof libraryID === "number" ? [libraryID] : [];
}
