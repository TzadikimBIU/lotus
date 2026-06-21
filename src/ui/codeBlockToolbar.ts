import { setIcon } from "obsidian";

export interface loomToolbarHandlers {
  onRun: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onToggleOutput: () => void;
}

export function createCodeBlockToolbar(
  blockId: string,
  isRunning: boolean,
  handlers: loomToolbarHandlers,
): HTMLDivElement {
  const toolbar = document.createElement("div");
  toolbar.className = "loom-code-toolbar";
  toolbar.dataset.loomBlockId = blockId;

  toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
  toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
  toolbar.appendChild(createButton("Remove snippet", "trash-2", handlers.onRemove, false));
  toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));

  return toolbar;
}

function createButton(label: string, iconName: string, onClick: () => void, spinning: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `loom-toolbar-button${spinning ? " is-running" : ""}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  setIcon(button, iconName);
  return button;
}
