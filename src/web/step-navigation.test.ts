/// <reference lib="dom" />

import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";

// HTML fixture representing the rendered step elements of a multi-recipe document.
// Step attributes mirror what renderDocument produces.
const FIXTURE_HTML = `
<article class="kr-root">
  <section data-kr-recipe-id="soup">
    <ol>
      <li class="kr-step" data-kr-recipe-id="soup" data-kr-step-index="0" aria-pressed="false">Boil water.</li>
      <li class="kr-step" data-kr-recipe-id="soup" data-kr-step-index="1" aria-pressed="false">Add salt.</li>
      <li class="kr-step" data-kr-recipe-id="soup" data-kr-step-index="2" aria-pressed="false">Add pepper.</li>
    </ol>
  </section>
  <section data-kr-recipe-id="salad">
    <ol>
      <li class="kr-step" data-kr-recipe-id="salad" data-kr-step-index="0" aria-pressed="false">Wash lettuce.</li>
      <li class="kr-step" data-kr-recipe-id="salad" data-kr-step-index="1" aria-pressed="false">Toss with dressing.</li>
    </ol>
  </section>
  <section data-kr-recipe-id="dessert">
    <ol>
      <li class="kr-step" data-kr-recipe-id="dessert" data-kr-step-index="0" aria-pressed="false">Melt chocolate.</li>
      <li class="kr-step" data-kr-recipe-id="dessert" data-kr-step-index="1" aria-pressed="false">Pour into mold.</li>
    </ol>
  </section>
</article>
`;

/**
 * Step navigation controller that mirrors the logic in KrRecipeElement.
 * The algorithm here MUST match #setCurrentStep, #advanceToNextStep,
 * and #advanceToPreviousStep in component.ts.
 */
class StepNavigationController {
  #container: Element;
  #activeRecipeId: string | null = null;
  #currentStepIndex = new Map<string, number>();

  constructor(container: Element) {
    this.#container = container;
  }

  setCurrentStep(recipeId: string, stepIndex: number): void {
    // Clear active step in all other recipes
    if (this.#activeRecipeId && this.#activeRecipeId !== recipeId) {
      const oldSteps = Array.from(
        this.#container.querySelectorAll(`.kr-step[data-kr-recipe-id="${this.#activeRecipeId}"]`)
      );
      oldSteps.forEach((step) => step.setAttribute("aria-pressed", "false"));
    }

    this.#activeRecipeId = recipeId;
    this.#currentStepIndex.set(recipeId, stepIndex);

    const steps = Array.from(
      this.#container.querySelectorAll(`.kr-step[data-kr-recipe-id="${recipeId}"]`)
    );
    steps.forEach((step) => {
      const thisStepIndex = Number(step.getAttribute("data-kr-step-index"));
      step.setAttribute("aria-pressed", thisStepIndex === stepIndex ? "true" : "false");
    });
  }

  advanceToNextStep(): void {
    const recipeId = this.#activeRecipeId;
    if (!recipeId) {
      const firstStep = this.#container.querySelector(".kr-step[data-kr-step-index]");
      if (firstStep) {
        const id = firstStep.getAttribute("data-kr-recipe-id") ?? "";
        this.setCurrentStep(id, 0);
      }
      return;
    }

    const currentIndex = this.#currentStepIndex.get(recipeId) ?? 0;
    const nextStep = this.#container.querySelector(
      `.kr-step[data-kr-recipe-id="${recipeId}"][data-kr-step-index="${currentIndex + 1}"]`
    );
    if (nextStep) {
      this.setCurrentStep(recipeId, currentIndex + 1);
    }
  }

  advanceToPreviousStep(): void {
    const recipeId = this.#activeRecipeId;
    if (!recipeId) return;

    const currentIndex = this.#currentStepIndex.get(recipeId) ?? 0;
    if (currentIndex === 0) return;

    const prevStep = this.#container.querySelector(
      `.kr-step[data-kr-recipe-id="${recipeId}"][data-kr-step-index="${currentIndex - 1}"]`
    );
    if (prevStep) {
      this.setCurrentStep(recipeId, currentIndex - 1);
    }
  }

  jumpToNextRecipe(): void {
    const recipeIds = this.#getRecipeIds();
    const currentIdx = this.#activeRecipeId ? recipeIds.indexOf(this.#activeRecipeId) : -1;
    if (currentIdx < 0 || currentIdx >= recipeIds.length - 1) return;
    this.setCurrentStep(recipeIds[currentIdx + 1]!, 0);
  }

  jumpToPreviousRecipe(): void {
    const recipeIds = this.#getRecipeIds();
    const currentIdx = this.#activeRecipeId ? recipeIds.indexOf(this.#activeRecipeId) : -1;
    if (currentIdx <= 0) return;
    this.setCurrentStep(recipeIds[currentIdx - 1]!, 0);
  }

  #getRecipeIds(): string[] {
    const steps = Array.from(this.#container.querySelectorAll(".kr-step[data-kr-recipe-id]"));
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const step of steps) {
      const id = step.getAttribute("data-kr-recipe-id") ?? "";
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }
}

function createDOM() {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${FIXTURE_HTML}</body></html>`);
  const container = document.querySelector(".kr-root")!;
  return container;
}

function getActiveSteps(container: Element): { recipeId: string; stepIndex: string }[] {
  const active = Array.from(container.querySelectorAll('.kr-step[aria-pressed="true"]'));
  return active.map((s) => ({
    recipeId: s.getAttribute("data-kr-recipe-id") ?? "",
    stepIndex: s.getAttribute("data-kr-step-index") ?? "",
  }));
}

describe("multi-recipe step navigation", () => {
  test("clicking a step in recipe B clears active step in recipe A", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("soup", 0);
    let active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("soup");

    ctrl.setCurrentStep("salad", 0);
    active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("arrow down advances within the active recipe only", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 0);
    ctrl.advanceToNextStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("1");
  });

  test("arrow down at last step stays (does not jump to another recipe)", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 1);
    ctrl.advanceToNextStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("1");
  });

  test("arrow up at first step stays (does not jump to another recipe)", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 0);
    ctrl.advanceToPreviousStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("arrow up moves backward within active recipe", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("soup", 2);
    ctrl.advanceToPreviousStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("soup");
    expect(active[0]!.stepIndex).toBe("1");
  });

  test("space (advance) works like arrow down", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 0);
    ctrl.advanceToNextStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("1");
  });

  test("advance at last step stays (does not wrap)", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 1);
    ctrl.advanceToNextStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("1");
  });

  test("navigation after switching recipes stays in new recipe", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("soup", 0);
    expect(getActiveSteps(container)[0]!.recipeId).toBe("soup");

    ctrl.setCurrentStep("salad", 0);

    ctrl.advanceToNextStep();
    let active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("1");

    ctrl.advanceToPreviousStep();
    active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("advance with no active recipe activates first step of first recipe", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.advanceToNextStep();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("soup");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("shift+down jumps to next recipe at step 0", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("soup", 1);
    ctrl.jumpToNextRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("salad");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("shift+down from middle recipe jumps to next", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 1);
    ctrl.jumpToNextRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("dessert");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("shift+down at last recipe does not wrap", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("dessert", 0);
    ctrl.jumpToNextRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("dessert");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("shift+up jumps to previous recipe at step 0", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("salad", 1);
    ctrl.jumpToPreviousRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("soup");
    expect(active[0]!.stepIndex).toBe("0");
  });

  test("shift+up at first recipe does not wrap", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.setCurrentStep("soup", 2);
    ctrl.jumpToPreviousRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(1);
    expect(active[0]!.recipeId).toBe("soup");
    expect(active[0]!.stepIndex).toBe("2");
  });

  test("shift+up with no active recipe does nothing", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.jumpToPreviousRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(0);
  });

  test("shift+down with no active recipe does nothing", () => {
    const container = createDOM();
    const ctrl = new StepNavigationController(container);

    ctrl.jumpToNextRecipe();

    const active = getActiveSteps(container);
    expect(active).toHaveLength(0);
  });
});
