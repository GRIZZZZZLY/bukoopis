import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RelationshipQualities } from "../RelationshipQualities";

const updateRelationship = vi.fn();
vi.mock("@/api/client", () => ({ api: { updateRelationship: (...a: unknown[]) => updateRelationship(...a) } }));

const rel = {
  id: 5, bookId: 3, fromCharacterId: 1, toCharacterId: 2,
  type: "напарник", tension: 0, notes: null, revision: 2,
  profile: { schemaVersion: 2, trust: null, respect: null, attachment: null,
    dependency: null, fear: null, duty: null, resentment: null,
    expectations: null, disputes: [], silences: [], register: null, extra: {} },
  createdAt: "", updatedAt: "",
};

beforeEach(() => updateRelationship.mockReset());

describe("RelationshipQualities", () => {
  it("сохраняет с текущей ревизией", async () => {
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("доверие"), "верит на слово");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { expectedRevision: number }];
    expect(body.expectedRevision).toBe(2);
  });

  it("409 показывает понятное сообщение, а не код", async () => {
    updateRelationship.mockImplementationOnce(() =>
      Promise.reject(new Error("revision_conflict"))
    );
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("доверие"), "х");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("изменилась");
    expect(alert.textContent).not.toContain("revision_conflict");
  });

  it("типированное значение качества попадает в profile", async () => {
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("доверие"), "верит на слово");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { profile: unknown }];
    expect((body.profile as Record<string, unknown>).trust).toBe("верит на слово");
  });

  it("очистка поля посылает null в profile", async () => {
    const relWithTrust = { ...rel, profile: { ...rel.profile, trust: "существующее доверие" } };
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={relWithTrust as never} onSaved={vi.fn()} />);
    const input = screen.getByLabelText("доверие");
    await userEvent.tripleClick(input);
    await userEvent.keyboard(" ");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { profile: unknown }];
    expect((body.profile as Record<string, unknown>).trust).toBeNull();
  });

  it("можно вбить второй пункт разногласий", async () => {
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("разногласия"), "деньги, карьера");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { profile: unknown }];
    expect((body.profile as Record<string, unknown>).disputes).toEqual(["деньги", "карьера"]);
  });

  it("разногласия без blur уходят в profile (не зависит от focus)", async () => {
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    const input = screen.getByLabelText("разногласия");
    await userEvent.type(input, "первое, второе");
    // fireEvent не трогает focus, в отличие от userEvent: input остаётся в фокусе, onBlur не срабатывает
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { profile: unknown }];
    expect((body.profile as Record<string, unknown>).disputes).toEqual(["первое", "второе"]);
  });
});
