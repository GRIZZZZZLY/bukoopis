import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../Markdown";

/** Разделы Мастерской пишет модель: заголовки, списки, абзацы, выделение. */

describe("Markdown", () => {
  it("рисует заголовки, списки и абзацы, а не решётки со звёздочками", () => {
    const { container } = render(
      <Markdown
        text={"# Мир\n\nСухой континент.\n\n- соль\n- ветер\n\n## Города\n\n1. Ирта\n2. Соляна"}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Мир" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Города" })).toBeTruthy();
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.textContent).not.toContain("#");
    expect(container.textContent).not.toContain("- соль");
  });

  it("выделение остаётся выделением, а звёздочки не печатаются", () => {
    const { container } = render(<Markdown text={"**Соль** и *ветер* и `код`"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Соль");
    expect(container.querySelector("em")?.textContent).toBe("ветер");
    expect(container.querySelector("code")?.textContent).toBe("код");
    expect(container.textContent).toBe("Соль и ветер и код");
  });

  it("строки абзаца склеиваются, пустая строка делит абзацы", () => {
    const { container } = render(<Markdown text={"первая\nвторая\n\nтретья"} />);
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0]?.textContent).toBe("первая вторая");
  });

  it("разметку из текста модели нельзя внести в страницу", () => {
    const { container } = render(<Markdown text={"<script>alert(1)</script> и <b>жирный</b>"} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>жирный</b>");
  });
});
