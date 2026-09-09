import { getString } from "../utils/locale";
import { showHint } from "../utils/hint";

export { copyItemFilePath };

/** The reader's attachment if one is focused, else the library's current selection. */
function getCurrentItem(): Zotero.Item | undefined {
  const mainWindow = Zotero.getMainWindow();
  const currentReader = Zotero.Reader.getByTabID(
    mainWindow.Zotero_Tabs.selectedID,
  );
  if (currentReader?.itemID) {
    return Zotero.Items.get(currentReader.itemID);
  }
  return mainWindow.ZoteroPane.getSelectedItems()[0];
}

async function copyItemFilePath() {
  const win = Zotero.getMainWindow();
  const item = getCurrentItem();
  if (!item) {
    win.alert(getString("alert-notValidParentItemError"));
    return;
  }

  let attachment: Zotero.Item | false | undefined;
  if (item.isAttachment()) {
    attachment = item;
  } else if (item.isRegularItem()) {
    attachment = await item.getBestAttachment();
  }

  const path = attachment ? await attachment.getFilePathAsync() : false;
  if (!path) {
    win.alert(getString("alert-noFilePathError"));
    return;
  }

  new ztoolkit.Clipboard().addText(String(path), "text/plain").copy();
  showHint(`File path copied to clipboard: ${path}`);
}
