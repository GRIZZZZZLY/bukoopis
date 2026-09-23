import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CharacterCanon } from "../CharacterCanon";
import { api } from "@/api/client";
import type { Character } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    listCharacters: vi.fn(),
    listRelationships: vi.fn(),
    updateCharacter: vi.fn(),
    createCharacter: vi.fn(),
    setCharacterPromptVisibility: vi.fn(),
    deleteCharacter: vi.fn(),
  },
}));
vi.mock("@/components/AliasEditor", () => ({ AliasEditor: () => <div /> }));
vi.mock("@/components/VoiceSamples", () => ({ VoiceSamples: () => <div /> }));

const m = vi.mocked(api);

function ivar(): Character {
  return {
    id: 7,
    bookId: 3,
    canonicalName: "Ивар",
    revision: 4,
    hiddenFromPrompts: false,
    createdAt: "",
    updatedAt: "",
    profile: {
      description: "Смотритель маяка",
      voice: null,
      // То, чего форма не показывает, обязано вернуться нетронутым.
      goals: [{ text: "удержать маяк" }],
      extra: { любимая_снасть: "сеть" },
    } as unknown as Character["profile"],
  };
}

describe("CharacterCanon — карточка персонажа", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.listCharacters.mockResolvedValue([ivar()]);
    m.listRelationships.mockResolvedValue([]);
  });

  it("сохраняет правку с ревизией и целым профилем", async () => {
    m.updateCharacter.mockResolvedValue({ ...ivar(), revision: 5 });
    render(<CharacterCanon bookId={3} />);
    const voice = await screen.findByLabelText("Голос");
    await userEvent.type(voice, "Коротко и сухо");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(m.updateCharacter).toHaveBeenCalled());
    const [id, body] = m.updateCharacter.mock.calls[0]!;
    expect(id).toBe(7);
    expect(body.expectedRevision).toBe(4);
    expect(body.profile).toMatchObject({
      description: "Смотритель маяка",
      voice: "Коротко и сухо",
      goals: [{ text: "удержать маяк" }],
      extra: { любимая_снасть: "сеть" },
    });
  });

  it("на 409 говорит, что карточку изменили, и не теряет правку", async () => {
    m.updateCharacter.mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    render(<CharacterCanon bookId={3} />);
    const desc = await screen.findByLabelText("Описание");
    await userEvent.type(desc, " на мысе");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText(/Карточку изменили в другом месте/)).toBeInTheDocument();
    expect(screen.getByLabelText("Описание")).toHaveValue("Смотритель маяка на мысе");
  });
});
