"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCodeBlockToolbar = createCodeBlockToolbar;
const obsidian_1 = require("obsidian");
function createCodeBlockToolbar(blockId, isRunning, handlers) {
    const toolbar = document.createElement("div");
    toolbar.className = "lotus-code-toolbar";
    toolbar.dataset.lotusBlockId = blockId;
    toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
    toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
    toolbar.appendChild(createButton("Clear output", "trash-2", handlers.onClear, false));
    toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));
    return toolbar;
}
function createButton(label, iconName, onClick, spinning) {
    const button = document.createElement("button");
    button.className = `lotus-toolbar-button${spinning ? " is-running" : ""}`;
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    (0, obsidian_1.setIcon)(button, iconName);
    return button;
}
