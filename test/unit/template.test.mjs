/**
 * Enhanced Notes U3 — executable unit tests for the pure template capability layer.
 *
 * The project's own test suite runs inside Zotero (mocha + Zotero globals), so it
 * can't run standalone. These tests cover only the *pure* exports (no Zotero
 * access), bundled to /tmp/bn_u3 by bn_run_template_unit_tests.sh, and run with
 * `node --test`. Zotero-touching code (buildItemModel/buildNoteModel/getCiteKey/
 * applyDirectives) is verified live during U4 integration.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const BUNDLES = fileURLToPath(new URL("../.bundles", import.meta.url));
const OUT = BUNDLES;
const filters = require(join(OUT, "filters.cjs"));
const model = require(join(OUT, "model.cjs"));
const directives = require(join(OUT, "directives.cjs"));
const engine = require(join(OUT, "engine.cjs"));

// A representative item model (what buildItemModel produces at runtime).
const ITEM = {
  citekey: "smith2020",
  title: "A Study of Things",
  year: "2020",
  authors: [
    { lastName: "Smith", firstName: "Jane", name: "Smith, Jane" },
    { lastName: "Doe", firstName: "", name: "Doe" },
  ],
  tags: ["ItemNote", "todo"],
  abstract: "line one\nline two",
};

test("year: extracts a 4-digit year, else empty", () => {
  assert.equal(filters.year("2021-03-04"), "2021");
  assert.equal(filters.year("March 2019"), "2019");
  assert.equal(filters.year("01/2020"), "2020");
  assert.equal(filters.year(""), "");
  assert.equal(filters.year(undefined), "");
  assert.equal(filters.year(null), "");
  assert.equal(filters.year("no year here"), "");
});

test("sanitize_filename: replaces illegal chars + spaces with '-'", () => {
  assert.equal(
    filters.sanitizeFilename('a/b\\c?d%e*f:g|h"i<j>k l'),
    "a-b-c-d-e-f-g-h-i-j-k-l",
  );
  assert.equal(filters.sanitizeFilename("hello world"), "hello-world");
  assert.equal(filters.sanitizeFilename("clean-name.md"), "clean-name.md");
  assert.equal(filters.sanitizeFilename(""), "");
  assert.equal(filters.sanitizeFilename(undefined), "");
});

test("CUSTOM_FILTERS: registry exposes the engine-facing names", () => {
  assert.equal(typeof filters.CUSTOM_FILTERS.year, "function");
  assert.equal(typeof filters.CUSTOM_FILTERS.sanitize_filename, "function");
});

test("extractCiteKeyFromExtra: parses a 'Citation Key:' line", () => {
  assert.equal(
    model.extractCiteKeyFromExtra("Citation Key: smith2020"),
    "smith2020",
  );
  assert.equal(
    model.extractCiteKeyFromExtra("foo\nCitation Key: a_b-c\nbar"),
    "a_b-c",
  );
  assert.equal(
    model.extractCiteKeyFromExtra("Citation Key:\ttabbed2021"),
    "tabbed2021",
  );
  assert.equal(model.extractCiteKeyFromExtra("no key here"), "");
  assert.equal(model.extractCiteKeyFromExtra(""), "");
  assert.equal(model.extractCiteKeyFromExtra(undefined), "");
});

test("parseDirectives: addTags from string, array, dedupe, ignore junk", () => {
  assert.deepEqual(
    directives.parseDirectives({ addTags: "ItemNote" }).addTags,
    ["ItemNote"],
  );
  assert.deepEqual(
    directives.parseDirectives({ addTags: ["a", " b ", "a", ""] }).addTags,
    ["a", "b"],
  );
  assert.deepEqual(
    directives.parseDirectives({ addTags: "  spaced  " }).addTags,
    ["spaced"],
  );
  assert.deepEqual(directives.parseDirectives({}).addTags, []);
  assert.deepEqual(directives.parseDirectives({ addTags: 42 }).addTags, []);
  assert.deepEqual(directives.parseDirectives(null).addTags, []);
  assert.deepEqual(directives.parseDirectives("nope").addTags, []);
});

test("engine: renders an ItemNoteMD05-style template against the model", async () => {
  const tpl = [
    "# {{ item.citekey }}",
    "- Title: {{ item.title }}",
    "- Year: {{ item.year }}",
    "- Authors:",
    "{% for a in item.authors %}  - {{ a.name }}",
    '{% endfor %}- Tags: {{ item.tags | join: ", " }}',
    "- Abstract: {{ item.abstract | strip_newlines }}",
  ].join("\n");
  const out = await engine.renderTemplate(tpl, { item: ITEM });
  assert.match(out, /# smith2020/);
  assert.match(out, /- Title: A Study of Things/);
  assert.match(out, /- Year: 2020/);
  assert.match(out, /  - Smith, Jane/);
  assert.match(out, /  - Doe/);
  assert.match(out, /- Tags: ItemNote, todo/);
  // strip_newlines (Liquid built-in) collapses the abstract onto one line.
  assert.match(out, /- Abstract: line oneline two/);
});

test("engine: custom filters work inside templates", async () => {
  assert.equal(
    await engine.renderTemplate("{{ d | year }}", { d: "March 2019" }),
    "2019",
  );
  assert.equal(
    await engine.renderTemplate("{{ item.title | sanitize_filename }}", {
      item: ITEM,
    }),
    "A-Study-of-Things",
  );
});

test("engine: unknown variables render empty, not errors", async () => {
  assert.equal(
    await engine.renderTemplate("[{{ item.nope }}]", { item: ITEM }),
    "[]",
  );
});

test("engine: renderTemplateSafe never throws on bad markup", async () => {
  const res = await engine.renderTemplateSafe("{% for x in %}", {});
  assert.equal(res.ok, false);
  assert.match(res.output, /Template error:/);
});

test("oneline: collapses newline runs to a single space (matches legacy)", () => {
  assert.equal(filters.oneline("a\nb\r\nc"), "a b c");
  assert.equal(filters.oneline("a\n\n\nb"), "a b");
  assert.equal(filters.oneline("single line"), "single line");
  assert.equal(filters.oneline(undefined), "");
});

test("parseLiquidTemplate: legacy text (no sentinel) is not Liquid", () => {
  const t = "// @use-markdown\n[${x}](${y})";
  const meta = engine.parseLiquidTemplate(t);
  assert.equal(meta.isLiquid, false);
  assert.equal(meta.body, t);
});

test("parseLiquidTemplate: reads liquid/markdown/addTags header + strips it", () => {
  const t = [
    "<!--liquid-->",
    "<!--markdown-->",
    "<!--addTags: ItemNote, todo-->",
    "# {{ item.citekey }}",
    "body",
  ].join("\n");
  const meta = engine.parseLiquidTemplate(t);
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, true);
  assert.deepEqual(meta.directives.addTags, ["ItemNote", "todo"]);
  assert.equal(meta.body, "# {{ item.citekey }}\nbody");
});

test("parseLiquidTemplate: bare <!--liquid--> → no markdown, no tags", () => {
  const meta = engine.parseLiquidTemplate("<!--liquid-->\njust {{ x }}");
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, false);
  assert.deepEqual(meta.directives.addTags, []);
  assert.equal(meta.body, "just {{ x }}");
});

test("engine: [text]-style now + built-in date filter", async () => {
  const out = await engine.renderTemplate('{{ now | date: "%Y-%m-%d" }}', {
    now: new Date("2020-05-01T09:30:00Z"),
  });
  assert.match(out, /^2020-05-01$/);
});

test("engine: end-to-end Liquid ItemNote render (markdown body)", async () => {
  const t = [
    "<!--liquid-->",
    "<!--markdown-->",
    "<!--addTags: ItemNote-->",
    "# {{ item.citekey }}",
    "- Authors:",
    "{% for a in item.authors %}    - {{ a.name }}",
    "{% endfor %}- Year: {{ item.year }}",
    "- Abstract: {{ item.abstract | oneline }}",
  ].join("\n");
  const meta = engine.parseLiquidTemplate(t);
  const out = await engine.renderTemplate(meta.body, { item: ITEM });
  assert.match(out, /# smith2020/);
  assert.match(out, /    - Smith, Jane\n    - Doe/);
  assert.match(out, /- Year: 2020/);
  assert.match(out, /- Abstract: line one line two/); // oneline → space, not removed
});

test("engine: {% annotations %} tag emits host-precomputed HTML from context", async () => {
  const tpl = "<h2>Annotations</h2>\n{% annotations %}";
  const out = await engine.renderTemplate(tpl, {
    item: ITEM,
    __annotationsHTML__: "<p>highlighted text</p>",
  });
  assert.match(out, /<h2>Annotations<\/h2>/);
  assert.match(out, /<p>highlighted text<\/p>/);
});

test("engine: {% annotations %} is empty (not an error) when context key absent", async () => {
  const out = await engine.renderTemplate("[{% annotations %}]", {
    item: ITEM,
  });
  assert.equal(out, "[]");
});

test("engine: [QuickInsertV3] Liquid body renders a markdown link from link/linkText", async () => {
  // The shipped template is `[{{ linkText }}]({{ link }})` with <!--markdown-->;
  // md2html runs live (worker), so here we assert the Liquid render output.
  const meta = engine.parseLiquidTemplate(
    "<!--liquid-->\n<!--markdown-->\n[{{ linkText }}]({{ link }})",
  );
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, true);
  const out = await engine.renderTemplate(meta.body, {
    linkText: "My Note - Section",
    link: "zotero://note/u/ABCD1234/",
  });
  assert.equal(out, "[My Note - Section](zotero://note/u/ABCD1234/)");
});

test("engine: [ExportMDFileContent] passthrough emits mdContent verbatim", async () => {
  const meta = engine.parseLiquidTemplate("<!--liquid-->\n{{ mdContent }}");
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, false); // export content stays raw markdown
  const md = "# Heading\n\n- a\n- b\n";
  assert.equal(await engine.renderTemplate(meta.body, { mdContent: md }), md);
});

test("engine: export passthrough does NOT re-parse template syntax in the value", async () => {
  // A note whose content contains literal {{ }} / {% %} must pass through as-is
  // (Liquid never re-renders a variable's substituted value).
  const md = "text with {{ not_a_var }} and {% raw-ish %} literals";
  assert.equal(
    await engine.renderTemplate("{{ mdContent }}", { mdContent: md }),
    md,
  );
});

test("engine: [QuickImportV2] wraps host-precomputed linkContent in a blockquote", async () => {
  const meta = engine.parseLiquidTemplate(
    "<!--liquid-->\n<blockquote>\n{{ linkContent }}\n</blockquote>",
  );
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, false); // linkContent is already HTML
  const out = await engine.renderTemplate(meta.body, {
    linkContent: "<p>embedded note</p>",
  });
  assert.equal(out, "<blockquote>\n<p>embedded note</p>\n</blockquote>");
});

test("engine: [QuickNoteV5] emits precomputed comment HTML + annotation HTML", async () => {
  const meta = engine.parseLiquidTemplate(
    "<!--liquid-->\n{{ commentHTML }}{% annotations %}",
  );
  assert.equal(meta.isLiquid, true);
  assert.equal(meta.markdown, false);
  const out = await engine.renderTemplate(meta.body, {
    commentHTML: "<p>my comment</p>",
    __annotationsHTML__: "<div>annotation</div>",
  });
  assert.equal(out, "<p>my comment</p><div>annotation</div>");
});

test("engine: [QuickNoteV5] with no comment → just the annotation", async () => {
  const out = await engine.renderTemplate(
    "{{ commentHTML }}{% annotations %}",
    {
      commentHTML: "",
      __annotationsHTML__: "<div>annotation</div>",
    },
  );
  assert.equal(out, "<div>annotation</div>");
});

const FILENAME_TPL =
  "{%- if note.citekey != blank -%}{{ note.citekey }}.md{%- else -%}{{ note.title | sanitize_filename }}-{{ note.key }}.md{%- endif -%}";

test("engine: [ExportMDFileNameV2] uses citekey when present", async () => {
  const out = await engine.renderTemplate(FILENAME_TPL, {
    note: { citekey: "smith2020", title: "Whatever", key: "ABCD1234" },
  });
  assert.equal(out, "smith2020.md");
});

test("engine: [ExportMDFileNameV2] falls back to sanitized title + key", async () => {
  const out = await engine.renderTemplate(FILENAME_TPL, {
    note: { citekey: "", title: "My Note: Draft", key: "ABCD1234" },
  });
  assert.equal(out, "My-Note--Draft-ABCD1234.md");
});

test("engine: [ExportMDFileNameV2] empty title → -key.md (no stray whitespace)", async () => {
  const out = await engine.renderTemplate(FILENAME_TPL, {
    note: { citekey: "", title: "", key: "ABCD1234" },
  });
  assert.equal(out, "-ABCD1234.md");
});

// ── Update027: citation fields (publicationTitle/volume/issue/pages/publisher/
// place/fields) + creatorType, exercised through buildItemModel with a minimal
// Zotero mock, then rendered end-to-end through docs/examples/APSA.liquid.
import { readFileSync } from "node:fs";

const CREATOR_TYPES = { 1: "author", 2: "editor" };
function mockZotero() {
  globalThis.Zotero = {
    ItemTypes: { getName: () => "journalArticle" },
    CreatorTypes: {
      getName: (id) => {
        if (!(id in CREATOR_TYPES)) throw new Error("unknown creator type");
        return CREATOR_TYPES[id];
      },
    },
  };
}
function mockItem(fields, creators) {
  return {
    key: "ABCD1234",
    itemTypeID: 1,
    getField: (f) => fields[f] || "",
    getUsedFields: () => Object.keys(fields),
    getCreators: () => creators,
    getTags: () => [],
    getCollections: () => [],
  };
}
const AJPS_FIELDS = {
  title: "Polarization and state legislative elections",
  date: "2026-04",
  publicationTitle: "American Journal of Political Science",
  volume: "70",
  issue: "2",
  pages: "453-470",
  DOI: "10.1111/ajps.12973",
  url: "https://onlinelibrary.wiley.com/doi/10.1111/ajps.12973",
  extra: "Citation Key: Handan-Nader-PolarizationStateLegislative-2026",
};
const AJPS_CREATORS = [
  { firstName: "Cassandra", lastName: "Handan-Nader", creatorTypeID: 1 },
  { firstName: "Andrew C. W.", lastName: "Myers", creatorTypeID: 1 },
  { firstName: "Andrew B.", lastName: "Hall", creatorTypeID: 1 },
];

test("buildItemModel: exposes citation fields, item.fields and creatorType", async () => {
  mockZotero();
  const m = await model.buildItemModel(mockItem(AJPS_FIELDS, AJPS_CREATORS));
  assert.equal(m.publicationTitle, "American Journal of Political Science");
  assert.equal(m.volume, "70");
  assert.equal(m.issue, "2");
  assert.equal(m.pages, "453-470");
  assert.equal(m.publisher, "");
  assert.equal(m.place, "");
  assert.equal(m.fields.publicationTitle, "American Journal of Political Science");
  assert.equal(m.fields.publisher, undefined); // empty fields are omitted
  assert.deepEqual(
    m.creators.map((c) => c.creatorType),
    ["author", "author", "author"],
  );
  assert.equal(m.citekey, "Handan-Nader-PolarizationStateLegislative-2026");
});

test("buildItemModel: unknown/missing creatorTypeID → empty creatorType", async () => {
  mockZotero();
  const m = await model.buildItemModel(
    mockItem({ title: "X" }, [
      { firstName: "A", lastName: "B", creatorTypeID: 99 },
      { firstName: "C", lastName: "D" },
    ]),
  );
  assert.deepEqual(m.creators.map((c) => c.creatorType), ["", ""]);
});

const APSA = readFileSync(
  fileURLToPath(new URL("../../docs/examples/APSA.liquid", import.meta.url)),
  "utf8",
);

test("APSA.liquid: article citation + metadata block", async () => {
  mockZotero();
  const item = await model.buildItemModel(mockItem(AJPS_FIELDS, AJPS_CREATORS));
  const meta = engine.parseLiquidTemplate(APSA);
  assert.equal(meta.markdown, true);
  const out = await engine.renderTemplate(meta.body, { item });
  assert.match(out, /# Handan-Nader-PolarizationStateLegislative-2026--APSA\n\nCitation:\n\n/);
  assert.ok(
    out.includes(
      "Handan-Nader, Cassandra, Andrew C. W. Myers, and Andrew B. Hall. 2026. “Polarization and state legislative elections.” *American Journal of Political Science* 70(2): 453–470. https://doi.org/10.1111/ajps.12973.",
    ),
    out,
  );
  assert.match(out, /citeshort: \(Handan-Nader et al\. 2026\)/);
  assert.match(out, /auth: Cassandra Handan-Nader; Andrew Myers; Andrew Hall\n/);
  assert.match(out, /publisher: American Journal of Political Science/);
  assert.match(out, /doi: 10\.1111\/ajps\.12973/);
});

test("APSA.liquid: book excludes editors and uses place: publisher", async () => {
  mockZotero();
  const item = await model.buildItemModel(
    mockItem(
      { title: "Congress", date: "2004", publisher: "Yale University Press", place: "New Haven" },
      [
        { firstName: "David R.", lastName: "Mayhew", creatorTypeID: 1 },
        { firstName: "Ed", lastName: "Itor", creatorTypeID: 2 },
      ],
    ),
  );
  const out = await engine.renderTemplate(engine.parseLiquidTemplate(APSA).body, { item });
  assert.ok(out.includes("Mayhew, David R. 2004. *Congress*. New Haven: Yale University Press."), out);
  assert.match(out, /citeshort: \(Mayhew 2004\)/);
  assert.match(out, /auth: David Mayhew\n/);
  assert.doesNotMatch(out, /Itor/);
});
