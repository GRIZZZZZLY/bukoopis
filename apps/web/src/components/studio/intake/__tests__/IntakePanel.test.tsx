import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IntakePanel } from "../IntakePanel";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({ api: { intake: vi.fn() } }));
const m = vi.mocked(api);

const OK = {
  summary: [{ target: "world" as const, label: "Мир", count: 1, titles: ["Карта"] }],
  ideaSet: false,
  chapters: [],
  failures: [],
  revision: 2,
};

function file(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByLabelText("Перетащите файлы с материалами"), {
    dataTransfer: { files, types: ["Files"] },
  });
}

function renderPanel() {
  const onIntake = vi.fn();
  render(
    <MemoryRouter>
      <IntakePanel bookId={3} onIntake={onIntake} />
    </MemoryRouter>,
  );
  return onIntake;
}

describe("IntakePanel", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads dropped files to text and sends filename plus content", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "Барьер делит два мира.")]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    expect(m.intake).toHaveBeenCalledWith(3, [
      { filename: "Карта.md", content: "Барьер делит два мира." },
    ]);
  });

  it("shows the summary afterwards and tells the page to reload", async () => {
    m.intake.mockResolvedValue(OK as never);
    const onIntake = renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByText("Материалы разобраны")).toBeInTheDocument());
    expect(onIntake).toHaveBeenCalled();
    expect(screen.queryByLabelText("Перетащите файлы с материалами")).toBeNull();
  });

  it("returns to the drop zone when the summary is dismissed", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => screen.getByText("Материалы разобраны"));
    fireEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("surfaces a failed request and keeps the drop zone", async () => {
    m.intake.mockRejectedValue(new Error("offline"));
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });
});
