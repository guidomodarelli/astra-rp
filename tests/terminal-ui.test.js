import { afterEach, describe, expect, it, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";

import { countTerminalRows, formatDuration, moveSelection, renderBox, renderRow, renderStepHeader, resolveNumberKey, visibleWidth } from "../src/terminal-ui.js";

describe("terminal boxes", () => {
  it("should wrap long lines by words, never truncate them, and keep every line aligned", () => {
    const sentence = "Corregí el error y corré pnpm create-version: retoma solo lo que falte sin volver a subir la versión.";
    const box = renderBox({ title: "Plan", lines: ["corto", `→ ${sentence}`], width: 40 }).split("\n");
    const bodyText = box
      .slice(2, -1)
      .map((line) => stripVTControlCharacters(line).slice(2, -2).trim())
      .join(" ");

    expect(new Set(box.map((line) => visibleWidth(line)))).toEqual(new Set([40]));
    expect(box.length).toBeGreaterThan(4);
    expect(box.join("\n")).not.toContain("…");
    expect(bodyText).toBe(`→ ${sentence}`);
    expect(stripVTControlCharacters(box[3]).startsWith("│   ")).toBe(true);
  });

  it("should reopen colors on every wrapped line and split words wider than the box", () => {
    const styledUrl = `\x1b[31mhttps://example.test/${"x".repeat(60)}\x1b[39m`;
    const box = renderBox({ lines: [styledUrl], width: 30 }).split("\n");

    expect(new Set(box.map((line) => visibleWidth(line)))).toEqual(new Set([30]));
    expect(box.slice(1, -1).every((line) => line.includes("\x1b[31m"))).toBe(true);
    expect(box.join("\n")).not.toContain("…");
  });

  it("should move a title that does not fit in the border inside the box", () => {
    const title = "Falló el paso 1: Crear y publicar la nueva versión";
    const box = renderBox({ title, lines: ["detalle"], width: 30 });

    expect(stripVTControlCharacters(box.split("\n")[0])).toBe(`╭${"─".repeat(28)}╮`);
    expect(stripVTControlCharacters(box)).toContain("Falló el paso 1:");
  });

  it("should align the value column of status rows", () => {
    expect(stripVTControlCharacters(renderRow("*", "Rama", "main"))).toBe(`* ${"Rama".padEnd(16)}main`);
    expect(stripVTControlCharacters(renderRow("*", "@siteping/adapter-drizzle", "al día"))).toBe("* @siteping/adapter-drizzle al día");
  });
});

describe("numbered prompt options", () => {
  it("should pick an option with its number key and ignore keys outside the listed options", () => {
    expect(resolveNumberKey("1", 3)).toBe(0);
    expect(resolveNumberKey("3", 3)).toBe(2);
    expect(resolveNumberKey("4", 3)).toBe(-1);
    expect(resolveNumberKey("0", 3)).toBe(-1);
    expect(resolveNumberKey("a", 3)).toBe(-1);
    expect(resolveNumberKey(undefined, 3)).toBe(-1);
  });
});

describe("prompt navigation", () => {
  it("should select the first option going down and the last one going up when nothing is selected yet", () => {
    expect(moveSelection(null, { name: "down" }, 3)).toBe(0);
    expect(moveSelection(null, { name: "tab" }, 3)).toBe(0);
    expect(moveSelection(null, { name: "up" }, 3)).toBe(2);
    expect(moveSelection(null, { name: "return" }, 3)).toBeNull();
  });

  it("should move with up/k and down/j/Tab, wrapping around the options", () => {
    expect(moveSelection(1, { name: "k" }, 3)).toBe(0);
    expect(moveSelection(0, { name: "up" }, 3)).toBe(2);
    expect(moveSelection(2, { name: "tab" }, 3)).toBe(0);
    expect(moveSelection(1, { name: "j" }, 3)).toBe(2);
  });
});

describe("prompt redraw", () => {
  it("should count the extra rows of lines wider than the terminal so the prompt erases all of them", () => {
    const question = "? ¿Publicar beez-ui@0.6.2? Commitea package.json y CHANGELOG.md, valida todo (varios minutos), pushea a main y publica en npm.";
    expect(countTerminalRows(["corta", "otra"], 80)).toBe(2);
    expect(countTerminalRows([question, "  1. Sí", "  2. No"], 80)).toBe(4);
    expect(countTerminalRows([`\x1b[1m${"x".repeat(80)}\x1b[22m`], 80)).toBe(1);
    expect(countTerminalRows([""], 80)).toBe(1);
  });
});

describe("durations", () => {
  it("should format seconds under a minute and minutes with padded seconds", () => {
    expect(formatDuration(3200)).toBe("3.2 s");
    expect(formatDuration(245_000)).toBe("4 min 05 s");
  });
});

describe("step header", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should paint every rule segment of the step header with the step accent color", () => {
    // Arrange
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "1");
    const magentaOpen = "\u001b[35m";
    const colorReset = "\u001b[39m";
    // Act
    const header = renderStepHeader(4, 4, "Enviar el release a GitHub Actions");
    // Assert
    expect(stripVTControlCharacters(header)).toContain("━━ PASO 4/4 ━ Enviar el release a GitHub Actions ━");
    const [unpaintedPrefix, ...magentaChunks] = header.split(magentaOpen);
    const textOutsideMagenta = [unpaintedPrefix, ...magentaChunks.map((chunk) => chunk.slice(chunk.indexOf(colorReset) + colorReset.length))].join("");
    expect(textOutsideMagenta).not.toContain("━");
  });

  it("should keep only the step label in bold and leave a blank line before the step output", () => {
    // Arrange
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "1");
    const boldOpen = "\u001b[1m";
    const boldReset = "\u001b[22m";
    // Act
    const header = renderStepHeader(2, 5, "Validar el proyecto");
    // Assert
    const boldText = header.split(boldOpen).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf(boldReset)));
    expect(boldText.map((text) => stripVTControlCharacters(text))).toEqual([" PASO 2/5 "]);
    expect(stripVTControlCharacters(header).split("\n").map((line) => line.trim().length > 0)).toEqual([false, true, false]);
  });
});
