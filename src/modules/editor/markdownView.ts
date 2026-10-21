/**
 * U26: read-only "View as Markdown" pane for the note editor.
 *
 * Zotero keeps notes as HTML, so there is no raw markdown to show — it only
 * exists when `note2md` runs for export/sync. This pane runs that same
 * conversion on the editor's live content and shows the result in a read-only
 * text area laid over the editor body, so what you see is what Obsidian gets.
 *
 * It is strictly a view. Nothing here saves the note, converts markdown back
 * (`md2note` is never imported), copies images into the attachment folder, or
 * touches sync state. The toggle is not persisted: it lives on the DOM of one
 * editor instance, and a new instance (note switch, reopen, new tab/window)
 * always starts in the rendered view.
 */
import { getString } from "../../utils/locale";
import { showHint } from "../../utils/hint";
import { getEditorItem, getEditorWindow, tryGetEditorCore } from "./adapter";

const OVERLAY_ID = "enhanced-notes-markdown-view";

/** Editor instances currently showing the markdown pane. */
const activeEditors = new WeakSet<Zotero.EditorInstance>();

export function isMarkdownViewOpen(editor: Zotero.EditorInstance) {
  return activeEditors.has(editor) && !!getOverlay(editor);
}

export async function toggleMarkdownView(editor: Zotero.EditorInstance) {
  if (isMarkdownViewOpen(editor)) {
    closeMarkdownView(editor);
  } else {
    await openMarkdownView(editor);
  }
}

/**
 * Called whenever an editor instance initializes. Zotero reuses the same
 * iframe when the item pane switches notes, so a pane left open on the
 * previous note would otherwise survive into the next one.
 */
export function resetMarkdownView(editor: Zotero.EditorInstance) {
  activeEditors.delete(editor);
  removeOverlay(getEditorWindow(editor).document);
}

function getOverlay(editor: Zotero.EditorInstance) {
  return getEditorWindow(editor).document.getElementById(OVERLAY_ID);
}

function removeOverlay(doc: Document) {
  doc.getElementById(OVERLAY_ID)?.remove();
  const core = doc.querySelector(".editor-core") as HTMLElement | null;
  core?.style.removeProperty("display");
  const middle = doc.querySelector(".toolbar .middle") as HTMLElement | null;
  middle?.classList.remove("enhanced-notes-md-disabled");
}

function closeMarkdownView(editor: Zotero.EditorInstance) {
  resetMarkdownView(editor);
  try {
    (tryGetEditorCore(editor)?.view as any)?.focus?.();
  } catch (e) {
    // Focus is a nicety; the editor is already visible again.
  }
}

async function openMarkdownView(editor: Zotero.EditorInstance) {
  const doc = getEditorWindow(editor).document;
  const core = doc.querySelector(".editor-core") as HTMLElement | null;
  if (!core?.parentElement) {
    showHint("Markdown view unavailable — editor layout not found.");
    return;
  }
  removeOverlay(doc);

  const text = ztoolkit.UI.createElement(doc, "textarea", {
    classList: ["enhanced-notes-md-text"],
    attributes: { readonly: "true", spellcheck: "false", wrap: "soft" },
    properties: { value: getString("editor-markdownView-loading") },
  }) as HTMLTextAreaElement;
  const error = ztoolkit.UI.createElement(doc, "div", {
    classList: ["enhanced-notes-md-error"],
    styles: { display: "none" },
  }) as HTMLDivElement;
  const copyButton = ztoolkit.UI.createElement(doc, "button", {
    classList: ["enhanced-notes-md-copy"],
    properties: {
      textContent: getString("editor-markdownView-copy"),
      disabled: true,
    },
    listeners: [
      {
        type: "click",
        listener: () => {
          new ztoolkit.Clipboard().addText(text.value, "text/plain").copy();
          showHint(getString("editor-markdownView-copied"));
        },
      },
    ],
  }) as HTMLButtonElement;
  const backButton = ztoolkit.UI.createElement(doc, "button", {
    classList: ["enhanced-notes-md-back"],
    properties: {
      textContent: getString("editor-toolbar-settings-viewRendered"),
    },
    listeners: [{ type: "click", listener: () => closeMarkdownView(editor) }],
  }) as HTMLButtonElement;

  const bar = ztoolkit.UI.createElement(doc, "div", {
    classList: ["enhanced-notes-md-bar"],
    children: [
      {
        tag: "span",
        classList: ["enhanced-notes-md-label"],
        properties: {
          textContent: getString("editor-markdownView-label"),
        },
      },
    ],
  }) as HTMLDivElement;
  bar.append(copyButton, backButton);

  const overlay = ztoolkit.UI.createElement(doc, "div", {
    id: OVERLAY_ID,
    listeners: [
      {
        // Keep keystrokes away from the editor's own window-level handlers
        // (find bar, formatting shortcuts) — the hidden note must not change.
        // Select-all, copy and scrolling are default actions and still work.
        type: "keydown",
        listener: (e: Event) => e.stopPropagation(),
      },
    ],
  }) as HTMLDivElement;
  overlay.append(bar, error, text);

  core.parentElement.insertBefore(overlay, core);
  core.style.display = "none";
  // The formatting buttons would edit the hidden note; grey them out.
  doc
    .querySelector(".toolbar .middle")
    ?.classList.add("enhanced-notes-md-disabled");
  activeEditors.add(editor);

  try {
    const markdown = await renderMarkdown(editor);
    if (!overlay.isConnected) {
      return; // closed or switched away while converting
    }
    text.value = markdown;
    copyButton.disabled = false;
    text.focus();
    text.setSelectionRange(0, 0);
    text.scrollTop = 0;
  } catch (e) {
    ztoolkit.log("[EnhancedNotes] View as Markdown failed", e);
    if (!overlay.isConnected) {
      return;
    }
    text.value = "";
    text.style.display = "none";
    error.textContent = `${getString("editor-markdownView-error")} ${
      (e as Error)?.message || String(e)
    }`;
    error.style.removeProperty("display");
  }
}

/**
 * Convert the editor's current content with the export/sync pipeline. Side
 * effect free: `skipSavingImages` keeps images out of the attachment folder,
 * and the synced file is only read (for its user-owned front matter), never
 * written.
 */
async function renderMarkdown(editor: Zotero.EditorInstance) {
  const noteItem = getEditorItem(editor);
  // The live document, including edits not yet saved. Falls back to the saved
  // copy if Zotero's editor core ever stops exposing getHTML.
  const liveHTML: string | undefined = (
    tryGetEditorCore(editor) as any
  )?.getHTML?.();
  const noteHTML = liveHTML ?? noteItem.getNote();

  let dir = Zotero.getTempDirectory().path as string;
  let cachedYAMLHeader: Record<string, any> | undefined;
  if (addon.api.sync.isSyncNote(noteItem.id)) {
    const status = addon.api.sync.getSyncStatus(noteItem.id);
    if (status.path) {
      dir = status.path;
    }
    try {
      cachedYAMLHeader =
        (await addon.api.sync.getMDStatus(noteItem.id)).meta ?? undefined;
    } catch (e) {
      // No readable synced file — the generated header alone is still right.
    }
  }

  return await addon.api.convert.note2md(noteItem, dir, {
    keepNoteLink: false,
    withYAMLHeader: true,
    cachedYAMLHeader,
    skipSavingImages: true,
    noteHTML,
  });
}
