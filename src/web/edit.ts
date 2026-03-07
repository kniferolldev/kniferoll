/// <reference lib="dom" />

/**
 * Edit mode interaction handlers for the kr-recipe web component.
 * Handles inline editing of ingredients, steps, title, and notes.
 */

import type { DocumentParseResult, Ingredient } from "../core/types";
import type { SourceSpan } from "../core/source-spans";
import {
  reconstructIngredientLine,
  getAttributeTail,
  getSourceLines,
  buildSpanEdit,
  unwrapText,
  splitPrefix,
  wrapLine,
} from "../core/edit-format";

export interface EditCallbacks {
  /** Get the current markdown content */
  getMarkdown(): string;
  /** Apply edits and re-render. Returns the new markdown. */
  applyEdit(edits: Map<number, string | null>): void;
}

interface ActiveEdit {
  /** The element being edited */
  element: HTMLElement;
  /** Save the current edit and restore the element */
  save(): void;
  /** Cancel the edit and restore the original element */
  cancel(): void;
}

/**
 * Set up edit mode interactions on the shadow root.
 * Returns a cleanup function to remove event listeners.
 */
export function setupEditInteractions(
  shadow: ShadowRoot,
  parseResult: DocumentParseResult,
  sourceSpans: Map<number, SourceSpan>,
  callbacks: EditCallbacks,
): { cleanup: () => void; saveActive: () => void } {
  let activeEdit: ActiveEdit | null = null;

  const saveActive = () => {
    if (activeEdit) {
      activeEdit.save();
      activeEdit = null;
    }
  };

  const cancelActive = () => {
    if (activeEdit) {
      activeEdit.cancel();
      activeEdit = null;
    }
  };

  // Build lookup of ingredients by line number
  const ingredientsByLine = new Map<number, Ingredient>();
  for (const recipe of parseResult.recipes) {
    for (const section of recipe.sections) {
      if (section.kind === "ingredients") {
        for (const ing of section.ingredients) {
          ingredientsByLine.set(ing.line, ing);
        }
      }
    }
  }

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Don't handle clicks inside edit inputs
    if (target.closest(".kr-edit-form")) {
      return;
    }

    // Find the editable element that was clicked
    const ingredient = target.closest<HTMLElement>(".kr-ingredient");
    const step = target.closest<HTMLElement>(".kr-step");
    const title = target.closest<HTMLElement>(".kr-recipe__title");
    const introP = target.closest<HTMLElement>(".kr-intro__p");
    const noteElement = target.closest<HTMLElement>(
      ".kr-notes__paragraph, .kr-notes__list-item, .kr-notes__header",
    );

    if (ingredient) {
      e.preventDefault();
      e.stopPropagation();
      saveActive();
      editIngredient(ingredient);
    } else if (step) {
      e.preventDefault();
      e.stopPropagation();
      saveActive();
      editStep(step);
    } else if (title) {
      e.preventDefault();
      e.stopPropagation();
      saveActive();
      editTitle(title);
    } else if (introP) {
      e.preventDefault();
      e.stopPropagation();
      saveActive();
      editTextLine(introP);
    } else if (noteElement) {
      e.preventDefault();
      e.stopPropagation();
      saveActive();
      editTextLine(noteElement);
    } else {
      // Click outside any editable — save current edit
      saveActive();
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && activeEdit) {
      e.preventDefault();
      e.stopPropagation();
      cancelActive();
    }
  };

  function editIngredient(li: HTMLElement) {
    const lineNum = Number(li.dataset.krLine);
    if (!lineNum) return;

    const ingredient = ingredientsByLine.get(lineNum);
    if (!ingredient) return;

    const span = sourceSpans.get(lineNum);
    if (!span) return;

    const originalHTML = li.innerHTML;
    const originalLineText = getSourceLines(
      callbacks.getMarkdown(),
      span.startLine,
      span.endLine,
    );
    const attributeTail = getAttributeTail(originalLineText);

    // Create edit form — matches the ingredient grid layout:
    // Column 1 (auto): quantity input
    // Column 2 (1fr): name + modifiers wrapper
    const form = document.createElement("div");
    form.className = "kr-edit-form kr-edit-ingredient-form";

    const qtyInput = document.createElement("input");
    qtyInput.type = "text";
    qtyInput.className = "kr-edit-input kr-edit-input--quantity";
    qtyInput.value = ingredient.quantityText ?? "";
    qtyInput.placeholder = "Qty";
    qtyInput.setAttribute("aria-label", "Quantity");

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "kr-edit-ingredient-content";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "kr-edit-input kr-edit-input--name";
    nameInput.value = ingredient.name;
    nameInput.placeholder = "Name";
    nameInput.setAttribute("aria-label", "Ingredient name");

    const modInput = document.createElement("input");
    modInput.type = "text";
    modInput.className = "kr-edit-input kr-edit-input--modifiers";
    modInput.value = ingredient.modifiers ?? "";
    modInput.placeholder = "Modifiers";
    modInput.setAttribute("aria-label", "Modifiers");

    contentWrapper.append(nameInput, modInput);
    form.append(qtyInput, contentWrapper);

    li.innerHTML = "";
    li.appendChild(form);

    // Focus name input
    nameInput.focus();
    nameInput.select();

    const save = () => {
      const name = nameInput.value.trim();
      if (!name) {
        cancel();
        return;
      }
      const qty = qtyInput.value.trim() || null;
      const mods = modInput.value.trim() || null;
      const newLine = reconstructIngredientLine(name, qty, mods, attributeTail);
      const edits = buildSpanEdit(span.startLine, span.endLine, newLine);
      callbacks.applyEdit(edits);
    };

    const cancel = () => {
      li.innerHTML = originalHTML;
      activeEdit = null;
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };

    qtyInput.addEventListener("keydown", handleKey);
    nameInput.addEventListener("keydown", handleKey);
    modInput.addEventListener("keydown", handleKey);

    activeEdit = { element: li, save, cancel };
  }

  /** Create an auto-sizing textarea that saves on Enter. */
  function makeAutoTextarea(
    value: string,
    className: string,
    ariaLabel: string,
  ): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    ta.className = className;
    ta.value = value;
    ta.setAttribute("aria-label", ariaLabel);
    ta.rows = 1;

    const autoSize = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    };
    ta.addEventListener("input", autoSize);
    // Initial sizing after the element is in the DOM
    requestAnimationFrame(autoSize);

    return ta;
  }

  function editStep(p: HTMLElement) {
    const lineNum = Number(p.dataset.krLine);
    if (!lineNum) return;

    const span = sourceSpans.get(lineNum);
    if (!span) return;

    const originalHTML = p.innerHTML;
    const rawText = getSourceLines(
      callbacks.getMarkdown(),
      span.startLine,
      span.endLine,
    );

    // Unwrap continuation lines and strip the step number prefix
    const unwrapped = unwrapText(rawText);
    const { prefix, content } = splitPrefix(unwrapped);

    const form = document.createElement("div");
    form.className = "kr-edit-form kr-edit-step-form";

    const ta = makeAutoTextarea(content, "kr-edit-input kr-edit-input--step", "Step text");

    form.append(ta);

    // Preserve the step number span, replace only the content after it
    const numberSpan = p.querySelector(".kr-step-number");
    // Clear everything except the number span
    while (p.lastChild && p.lastChild !== numberSpan) {
      p.removeChild(p.lastChild);
    }
    p.appendChild(form);
    ta.focus();

    const save = () => {
      // Collapse any newlines the user may have entered
      const edited = ta.value.replace(/\n/g, " ").trim();
      if (!edited) {
        cancel();
        return;
      }
      // Re-wrap with the original step number prefix
      const newText = wrapLine(prefix + edited, prefix.length);
      const edits = buildSpanEdit(span.startLine, span.endLine, newText);
      callbacks.applyEdit(edits);
    };

    const cancel = () => {
      p.innerHTML = originalHTML;
      activeEdit = null;
    };

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        save();
      }
    });

    activeEdit = { element: p, save, cancel };
  }

  function editTitle(h2: HTMLElement) {
    const lineNum = Number(h2.dataset.krLine);
    if (!lineNum) return;

    const span = sourceSpans.get(lineNum);
    if (!span) return;

    const originalHTML = h2.innerHTML;
    const titleText = h2.textContent?.trim() ?? "";

    const form = document.createElement("div");
    form.className = "kr-edit-form kr-edit-title-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "kr-edit-input kr-edit-input--title";
    input.value = titleText;
    input.setAttribute("aria-label", "Recipe title");

    form.append(input);

    h2.innerHTML = "";
    h2.appendChild(form);
    input.focus();
    input.select();

    const save = () => {
      const newTitle = input.value.trim();
      if (!newTitle) {
        cancel();
        return;
      }
      // Determine heading level from original line
      const originalLine = getSourceLines(
        callbacks.getMarkdown(),
        span.startLine,
        span.startLine,
      );
      const headingMatch = originalLine.match(/^(#{1,6})\s/);
      const prefix = headingMatch ? headingMatch[1] : "#";
      const newLine = `${prefix} ${newTitle}`;
      const edits = buildSpanEdit(span.startLine, span.endLine, newLine);
      callbacks.applyEdit(edits);
    };

    const cancel = () => {
      h2.innerHTML = originalHTML;
      activeEdit = null;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });

    activeEdit = { element: h2, save, cancel };
  }

  /**
   * Generic inline editor for any text element: intro paragraphs,
   * note paragraphs, note list items, note headers.
   * Unwraps continuation lines for editing, re-wraps on save.
   */
  function editTextLine(el: HTMLElement) {
    const lineNum = Number(el.dataset.krLine);
    if (!lineNum) return;

    const span = sourceSpans.get(lineNum);
    if (!span) return;

    const originalHTML = el.innerHTML;
    const rawText = getSourceLines(
      callbacks.getMarkdown(),
      span.startLine,
      span.endLine,
    );

    // Unwrap continuation lines and split off the markdown prefix
    const unwrapped = unwrapText(rawText);
    const { prefix, content } = splitPrefix(unwrapped);

    const form = document.createElement("div");
    form.className = "kr-edit-form kr-edit-text-form";

    const ta = makeAutoTextarea(content, "kr-edit-input kr-edit-input--text", "Text");

    form.append(ta);

    el.innerHTML = "";
    el.appendChild(form);
    ta.focus();

    const save = () => {
      const edited = ta.value.replace(/\n/g, " ").trim();
      if (!edited) {
        cancel();
        return;
      }
      // Re-wrap with the original prefix
      const newText = wrapLine(prefix + edited, prefix.length);
      const edits = buildSpanEdit(span.startLine, span.endLine, newText);
      callbacks.applyEdit(edits);
    };

    const cancel = () => {
      el.innerHTML = originalHTML;
      activeEdit = null;
    };

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        save();
      }
    });

    activeEdit = { element: el, save, cancel };
  }

  shadow.addEventListener("click", handleClick as EventListener, true);
  shadow.addEventListener("keydown", handleKeydown as EventListener);

  return {
    cleanup: () => {
      shadow.removeEventListener("click", handleClick as EventListener, true);
      shadow.removeEventListener("keydown", handleKeydown as EventListener);
      cancelActive();
    },
    saveActive,
  };
}
