import { highlightLlvmElement } from "./llvmHighlight";

interface PrismLike {
  highlightElement?: (element: Element) => void;
}

const LANGUAGE_CLASS_ALIASES: Record<string, string> = {
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  js: "javascript",
  ts: "typescript",
  sh: "shell",
  bash: "shell",
  llvm: "llvm-ir",
  llvmir: "llvm-ir",
  ll: "llvm-ir",
};

export function normalizeSyntaxLanguage(language: string | null | undefined): string | null {
  const trimmed = language?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return null;
  }

  const aliased = LANGUAGE_CLASS_ALIASES[trimmed] ?? trimmed;
  const normalized = aliased
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

export function addSyntaxLanguageClass(element: HTMLElement, language: string | null | undefined): string | null {
  const normalized = normalizeSyntaxLanguage(language);
  if (!normalized) {
    return null;
  }

  element.addClass(`language-${normalized}`);
  return normalized;
}

export function highlightCodeElement(codeElement: HTMLElement, source: string, language: string | null | undefined): void {
  const normalized = addSyntaxLanguageClass(codeElement, language);
  const parent = codeElement.parentElement;
  if (parent instanceof HTMLElement) {
    addSyntaxLanguageClass(parent, normalized);
  }

  if (normalized === "llvm-ir") {
    highlightLlvmElement(codeElement, source);
    return;
  }

  try {
    const prism = (window as typeof window & { Prism?: PrismLike }).Prism;
    prism?.highlightElement?.(codeElement);
  } catch {
    return;
  }
}
