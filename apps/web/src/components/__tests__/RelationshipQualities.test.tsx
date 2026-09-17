import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
