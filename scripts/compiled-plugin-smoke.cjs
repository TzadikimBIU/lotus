const Module = require("module");
const fs = require("fs");
const path = require("path");

const pluginDir = process.argv[2];
const outputPath = process.argv[3];
if (!pluginDir) {
  throw new Error("Usage: node scripts/compiled-plugin-smoke.cjs <plugin-dir> [output-json]");
}

const pluginPath = path.join(pluginDir, "main.js");
const originalLoad = Module._load;

Module._load = function loadShimmed(request, parent, isMain) {
  if (request === "obsidian") {
    return obsidianShim(pluginDir);
  }
  if (request === "@codemirror/state") {
    return {
      RangeSetBuilder: class {
        add() {}
        finish() { return []; }
      },
      StateEffect: {
        define: () => ({}),
      },
    };
  }
  if (request === "@codemirror/view") {
    return {
      Decoration: {
        widget: () => ({ range: () => ({}) }),
        mark: () => ({ range: () => ({}) }),
      },
      EditorView: class {},
      ViewPlugin: {
        fromClass: () => ({}),
      },
      WidgetType: class {},
    };
  }
  if (request === "@codemirror/language") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const loaded = require(pluginPath);
  const PluginClass = loaded.default ?? loaded;
  const instance = new PluginClass(fakeApp(), {
    id: "lotus",
    name: "lotus",
    dir: pluginDir,
    version: "0.1.0",
  });

  const languages = typeof instance.registry?.getSupportedLanguages === "function"
    ? instance.registry.getSupportedLanguages()
    : [];

  if (!languages.includes("python") || !languages.includes("ebpf-c")) {
    throw new Error(`Compiled plugin registry is missing expected languages: ${languages.join(", ")}`);
  }

  const result = JSON.stringify({
    ok: true,
    pluginPath,
    className: PluginClass.name,
    languages,
  }, null, 2);
  if (outputPath) {
    fs.writeFileSync(outputPath, `${result}\n`, "utf8");
  } else {
    console.log(result);
  }
} finally {
  Module._load = originalLoad;
}

function obsidianShim(dir) {
  class Plugin {
    constructor(app = fakeApp(), manifest = { dir }) {
      this.app = app;
      this.manifest = manifest;
    }
    addCommand() {}
    addSettingTab() {}
    addStatusBarItem() { return fakeElement(); }
    loadData() { return Promise.resolve({}); }
    registerCodeBlockProcessor() {}
    registerDomEvent() {}
    registerEditorExtension() {}
    registerEvent() {}
    registerMarkdownCodeBlockProcessor() {}
    registerMarkdownPostProcessor() {}
    saveData() { return Promise.resolve(); }
  }

  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = fakeElement();
    }
  }

  class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = fakeElement();
    }
    close() {}
    open() {}
  }

  class MarkdownRenderChild {
    constructor(containerEl) {
      this.containerEl = containerEl;
    }
  }

  class Setting {
    constructor(containerEl) {
      this.settingEl = containerEl ?? fakeElement();
    }
    addButton(callback) { callback?.(chainableControl()); return this; }
    addDropdown(callback) { callback?.(chainableControl()); return this; }
    addText(callback) { callback?.(chainableControl()); return this; }
    addToggle(callback) { callback?.(chainableControl()); return this; }
    setDesc() { return this; }
    setName() { return this; }
  }

  class TFile {}
  class WorkspaceLeaf {}
  class Notice {
    constructor(message) {
      this.message = message;
    }
  }

  return {
    App: class {},
    MarkdownRenderChild,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    WorkspaceLeaf,
    normalizePath: (value) => String(value).replace(/\\/g, "/").replace(/\/+/g, "/"),
  };
}

function fakeApp() {
  return {
    metadataCache: {
      getFileCache: () => ({}),
    },
    vault: {
      adapter: {
        basePath: process.cwd(),
      },
      cachedRead: async () => "",
      getAbstractFileByPath: () => null,
      process: async () => {},
    },
    workspace: {
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
}

function fakeElement() {
  return {
    addClass() {},
    addEventListener() {},
    appendChild() {},
    classList: { add() {}, remove() {} },
    createDiv: () => fakeElement(),
    createEl: () => fakeElement(),
    empty() {},
    parentElement: null,
    querySelector: () => null,
    remove() {},
    setText() {},
    toggleClass() {},
  };
}

function chainableControl() {
  return {
    addOption() { return this; },
    onChange() { return this; },
    onClick() { return this; },
    setButtonText() { return this; },
    setCta() { return this; },
    setDisabled() { return this; },
    setPlaceholder() { return this; },
    setValue() { return this; },
  };
}
