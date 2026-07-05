#!/usr/bin/env node
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const options = parseArgs(process.argv.slice(2));
const source = readFileSync(options.file, "utf8");
const latex = sourceToLatex(source);

if (options.format === "latex") {
  writeArtifacts({ latex });
  process.stdout.write(`${latex.trimEnd()}\n`);
} else {
  const html = renderHtmlPreview(latex);
  writeArtifacts({ html, latex });
  process.stdout.write(html);
}

function parseArgs(args) {
  let format = "html";
  let file = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      format = args[index + 1] ?? format;
      index += 1;
    } else if (!file) {
      file = arg;
    }
  }
  if (format !== "html" && format !== "latex") {
    throw new Error(`Unsupported Lilac output format: ${format}`);
  }
  if (!file) {
    throw new Error("Usage: lilac-lotus.mjs [--format html|latex] <source-file>");
  }
  return { format, file };
}

function sourceToLatex(sourceText) {
  const trimmed = sourceText.trim();
  if (!trimmed) {
    return "";
  }
  if (isFullLatexDocument(trimmed)) {
    return ensureLatexPackages(trimmed);
  }
  return renderDocument(parseDocument(trimmed));
}

function isFullLatexDocument(value) {
  return value.includes("\\documentclass") && value.includes("\\begin{document}") && value.includes("\\end{document}");
}

function parseDocument(sourceText) {
  const lines = sourceText.replace(/\r\n?/g, "\n").split("\n");
  const document = {
    name: "",
    role: "",
    contact: "",
    blocks: [],
  };
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;
  let math = null;
  let table = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      document.blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list?.items.length) {
      document.blocks.push(list);
    }
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) {
      document.blocks.push({ kind: "quote", text: quote.join(" ") });
      quote = [];
    }
  };
  const flushTable = () => {
    const rows = normalizeTableRows(table);
    if (rows.length) {
      document.blocks.push({ kind: "table", rows });
    }
    table = [];
  };
  const flushRunning = () => {
    flushParagraph();
    flushList();
    flushQuote();
    flushTable();
  };
  const appendListItem = (ordered, text) => {
    flushParagraph();
    flushQuote();
    flushTable();
    if (!list || list.ordered !== ordered) {
      flushList();
      list = { kind: "list", ordered, items: [] };
    }
    list.items.push(text);
  };

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    const trimmed = line.trim();
    const fence = trimmed.match(/^```+\s*([^`]*)$/);
    if (fence) {
      if (code) {
        document.blocks.push(code);
        code = null;
      } else {
        flushRunning();
        code = { kind: "code", language: normalizeCodeLanguage(fence[1]), lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(raw);
      continue;
    }
    if (trimmed === "$$") {
      if (math) {
        document.blocks.push({ kind: "math", lines: math });
        math = null;
      } else {
        flushRunning();
        math = [];
      }
      continue;
    }
    if (math) {
      math.push(raw);
      continue;
    }

    const directive = trimmed.match(/^@([A-Za-z][A-Za-z0-9_-]*)\s+(.+)$/);
    if (directive) {
      flushRunning();
      const key = directive[1].toLowerCase();
      const value = directive[2].trim();
      if (key === "name") document.name = value;
      else if (key === "contact") document.contact = value;
      else if (key === "role") document.role = value;
      else if (key === "job") document.blocks.push(roleBlock(value));
      else if (key === "project") document.blocks.push(projectBlock(value));
      else if (key === "pagebreak" || key === "newpage") document.blocks.push({ kind: "latex", latex: "\\newpage" });
      else paragraph.push(line);
      continue;
    }

    if (!trimmed) {
      flushRunning();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})[ \t]+(.+)$/);
    if (heading) {
      flushRunning();
      document.blocks.push({ kind: "heading", level: heading[1].length, title: heading[2] });
      continue;
    }
    const image = trimmed.match(/^!\[(.*)\]\(([^)]+)\)$/);
    if (image) {
      flushRunning();
      document.blocks.push({ kind: "image", caption: image[1], path: image[2] });
      continue;
    }
    if (isTableLine(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      table.push(parseTableRow(trimmed));
      continue;
    }
    const bullet = trimmed.match(/^[-*][ \t]+(.+)$/);
    if (bullet) {
      appendListItem(false, bullet[1]);
      continue;
    }
    const numbered = trimmed.match(/^[0-9]+[.)][ \t]+(.+)$/);
    if (numbered) {
      appendListItem(true, numbered[1]);
      continue;
    }
    const quoteLine = trimmed.match(/^>[ \t]?(.+)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      flushTable();
      quote.push(quoteLine[1]);
      continue;
    }
    const inlineMathBlock = trimmed.match(/^\$\$(.+)\$\$$/);
    if (inlineMathBlock) {
      flushRunning();
      document.blocks.push({ kind: "math", lines: [inlineMathBlock[1].trim()] });
      continue;
    }
    if (isMarkdownRule(trimmed)) {
      flushRunning();
      document.blocks.push({ kind: "rule" });
      continue;
    }
    flushTable();
    paragraph.push(line);
  }

  flushRunning();
  if (code) document.blocks.push(code);
  if (math) document.blocks.push({ kind: "math", lines: math });
  return document;
}

function roleBlock(value) {
  const [organization = "", title = "", location = ""] = splitFields(value);
  return { kind: "role", organization, title, location };
}

function projectBlock(value) {
  const [name = "", description = ""] = splitFields(value);
  return { kind: "project", name, description };
}

function splitFields(value) {
  return value.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
}

function renderDocument(document) {
  const body = document.blocks.flatMap(renderBlock).join("\n").trim();
  const header = renderHeader(document);
  const content = [header, body].filter(Boolean).join("\n\n");
  const packages = packageBlock(content, { includeHyperref: false });
  return `\\documentclass[10pt]{article}

\\usepackage[a4paper,left=0.68in,right=0.68in,top=0.55in,bottom=0.55in]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{microtype}
${packages}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{3pt}
\\setlist[itemize]{leftmargin=*,itemsep=3pt,parsep=0pt,topsep=3pt}
\\setlist[enumerate]{leftmargin=*,itemsep=3pt,parsep=0pt,topsep=3pt}
\\titleformat{\\section}{\\normalsize\\scshape}{}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{10pt}{5pt}
\\newcommand{\\role}[3]{\\textsc{#1}\\hfill{\\small #3}\\\\\\textit{#2}}

\\begin{document}

${content}

\\end{document}
`;
}

function renderHeader(document) {
  const lines = [];
  if (document.name) lines.push(`{\\Large\\textsc{${inlineLatex(document.name)}}}`);
  if (document.role) lines.push(`{\\normalsize ${inlineLatex(document.role)}}`);
  if (document.contact) lines.push(`{\\small ${renderContact(document.contact)}}`);
  return lines.length ? `\\begin{center}\n${lines.join("\\\\[2pt]\n")}\n\\end{center}` : "";
}

function renderContact(value) {
  return splitFields(value).map(inlineLatex).join(" \\quad ");
}

function renderBlock(block) {
  switch (block.kind) {
    case "paragraph":
      return [`${inlineLatexLines(block.text)}\n`];
    case "heading":
      return [`\\${headingCommand(block.level)}*{${inlineLatex(block.title)}}\n`];
    case "list":
      return renderList(block);
    case "quote":
      return [`\\begin{quote}\n${inlineLatex(block.text)}\n\\end{quote}\n`];
    case "math":
      return [`\\[\n${block.lines.join("\n")}\n\\]\n`];
    case "code":
      return renderCode(block);
    case "table":
      return renderTable(block);
    case "image":
      return renderImage(block);
    case "role":
      return [`\\role{${inlineLatex(block.organization)}}{${inlineLatex(block.title)}}{${inlineLatex(block.location)}}\n`];
    case "project":
      return [`\\begin{itemize}\n  \\item \\textbf{${inlineLatex(block.name)}} \\quad ${inlineLatex(block.description)}\n\\end{itemize}\n`];
    case "latex":
      return [`${block.latex}\n`];
    case "rule":
      return ["\\par\\noindent\\makebox[\\linewidth][l]{\\rule{\\linewidth}{0.45pt}}\\par\n"];
    default:
      return [];
  }
}

function renderList(block) {
  const environment = block.ordered ? "enumerate" : "itemize";
  return [
    `\\begin{${environment}}\n${block.items.map((item) => `  \\item ${inlineLatex(item)}`).join("\n")}\n\\end{${environment}}\n`,
  ];
}

function renderCode(block) {
  const language = listingsLanguage(block.language);
  const option = language ? `[language=${language}]` : "";
  return [`\\begin{lstlisting}${option}\n${block.lines.join("\n")}\n\\end{lstlisting}\n`];
}

function renderTable(block) {
  if (!block.rows.length) {
    return [];
  }
  const [header, ...body] = block.rows;
  const columnCount = Math.max(1, header.length);
  const spec = "l".repeat(columnCount);
  return [
    `\\begin{center}\n\\begin{tabular}{${spec}}\n\\toprule\n${renderTableRow(header)}\n\\midrule\n${body.map(renderTableRow).join("\n")}\n\\bottomrule\n\\end{tabular}\n\\end{center}\n`,
  ];
}

function renderTableRow(row) {
  return `${row.map(inlineLatex).join(" & ")} \\\\`;
}

function renderImage(block) {
  const path = escapeUrl(block.path.trim());
  if (!path) {
    return [];
  }
  const caption = block.caption.trim();
  return [
    `\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.85\\linewidth]{${path}}${caption ? `\n\\caption{${inlineLatex(caption)}}` : ""}\n\\end{figure}\n`,
  ];
}

function headingCommand(level) {
  if (level === 1) return "section";
  if (level === 2) return "subsection";
  return "subsubsection";
}

function inlineLatexLines(value) {
  return value.split("\n").map(inlineLatex).join("\n");
}

function inlineLatex(value) {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("**", index)) {
      const end = value.indexOf("**", index + 2);
      if (end >= 0) {
        output += `\\textbf{${escapeLatex(value.slice(index + 2, end))}}`;
        index = end + 2;
        continue;
      }
    }
    if (value[index] === "*") {
      const end = value.indexOf("*", index + 1);
      if (end >= 0) {
        output += `\\emph{${escapeLatex(value.slice(index + 1, end))}}`;
        index = end + 1;
        continue;
      }
    }
    if (value[index] === "`") {
      const end = value.indexOf("`", index + 1);
      if (end >= 0) {
        output += `\\texttt{${escapeLatex(value.slice(index + 1, end))}}`;
        index = end + 1;
        continue;
      }
    }
    if (value[index] === "$") {
      const end = value.indexOf("$", index + 1);
      if (end >= 0) {
        output += `\\(${sanitizeMath(value.slice(index + 1, end))}\\)`;
        index = end + 1;
        continue;
      }
    }
    const url = readUrl(value, index);
    if (url) {
      output += `\\url{${escapeUrl(url)}}`;
      index += url.length;
      continue;
    }
    output += escapeLatex(value[index]);
    index += 1;
  }
  return output;
}

function readUrl(value, index) {
  if (!value.startsWith("http://", index) && !value.startsWith("https://", index)) {
    return "";
  }
  const match = value.slice(index).match(/^\S+/);
  return match?.[0] ?? "";
}

function escapeLatex(value) {
  return value.replace(/[\\&%$#_{}~^]/g, (char) => ({
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    "_": "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  })[char] ?? char);
}

function sanitizeMath(value) {
  return value.replace(/\\(?:htmlonly|input|include|openin|openout|write|read)\b/g, "");
}

function escapeUrl(value) {
  return value.replace(/[{}\\]/g, "");
}

function isMarkdownRule(value) {
  return /^[-*_]{3,}$/.test(value);
}

function isTableLine(value) {
  return value.includes("|") && value.split("|").length >= 3;
}

function parseTableRow(value) {
  let line = value.trim();
  if (line.startsWith("|")) line = line.slice(1);
  if (line.endsWith("|")) line = line.slice(0, -1);
  return line.split("|").map((cell) => cell.trim());
}

function normalizeTableRows(rows) {
  return rows.filter((row) => !isTableDelimiter(row));
}

function isTableDelimiter(row) {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeCodeLanguage(info) {
  const token = info.trim().split(/\s+/)[0] ?? "";
  return token.replace(/[{}.]/g, "").toLowerCase();
}

function listingsLanguage(language) {
  return ({
    py: "Python",
    python: "Python",
    js: "JavaScript",
    javascript: "JavaScript",
    java: "Java",
    c: "C",
    cpp: "C++",
    "c++": "C++",
    sh: "bash",
    bash: "bash",
    shell: "bash",
    html: "HTML",
    tex: "TeX",
    latex: "TeX",
  })[language] ?? "";
}

function packageBlock(latex, options = {}) {
  const packages = [];
  const add = (line) => {
    if (!packages.includes(line)) packages.push(line);
  };
  if (/\\\[|\\begin\{(?:align|aligned|cases)/.test(latex)) add("\\usepackage{amsmath}");
  if (/\\includegraphics/.test(latex)) add("\\usepackage{graphicx}");
  if (options.includeHyperref !== false && /\\url\{/.test(latex)) add("\\usepackage[hidelinks]{hyperref}");
  if (/\\begin\{lstlisting\}|\\lstinline|\\lstset/.test(latex)) add("\\usepackage{listings}");
  if (/\\toprule|\\midrule|\\bottomrule|\\cmidrule/.test(latex)) {
    add("\\usepackage{booktabs}");
    add("\\usepackage{array}");
  }
  return packages.length ? `${packages.join("\n")}\n` : "";
}

function ensureLatexPackages(latex) {
  const begin = latex.indexOf("\\begin{document}");
  if (begin < 0) return latex;
  const packages = packageBlock(latex)
    .split("\n")
    .filter((line) => line && !latex.includes(line));
  if (!packages.length) return latex;
  return `${latex.slice(0, begin)}${packages.join("\n")}\n${latex.slice(begin)}`;
}

function renderHtmlPreview(latex) {
  const svg = latexToSvg(latex);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lilac preview</title><style>html,body{margin:0;background:#fff;color:#111;font-family:ui-serif,Georgia,serif}main{box-sizing:border-box;min-height:100vh;padding:32px;background:#fff}.page{width:min(100%,860px);margin:0 auto}.render svg{display:block;max-width:100%;height:auto;background:#fff}</style></head><body><main><div class="page"><div class="render">${svg}</div></div></main></body></html>`;
}

function latexToSvg(latex) {
  const tempDir = mkdtempSync(join(tmpdir(), "lilac-lotus-"));
  try {
    const texPath = join(tempDir, "document.tex");
    writeFileSync(texPath, latex, "utf8");
    run("latex", ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "-output-directory", tempDir, texPath]);
    const rendered = run("dvisvgm", ["--no-fonts", "--exact", "--stdout", join(tempDir, "document.dvi")]);
    const start = rendered.stdout.indexOf("<svg");
    if (start < 0) {
      throw new Error("dvisvgm did not emit an svg root");
    }
    const svg = rendered.stdout.slice(start).trim();
    const insert = svg.indexOf(">") + 1;
    return `${svg.slice(0, insert)}<rect width="100%" height="100%" fill="white"/>${svg.slice(insert)}`;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function writeArtifacts({ html, latex }) {
  const artifactDir = process.env.LOTUS_ARTIFACT_DIR;
  if (!artifactDir) {
    return;
  }
  if (latex) {
    writeFileSync(join(artifactDir, "document.tex"), `${latex.trimEnd()}\n`, "utf8");
  }
  if (html) {
    writeFileSync(join(artifactDir, "preview.html"), html, "utf8");
  }
}
