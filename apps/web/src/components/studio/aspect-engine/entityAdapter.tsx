import { z } from "zod";
import type { StageAdapter } from "./types.js";
import type { EntitySetPayload } from "@book-forge/shared";

const candidateSchema = z.object({
  tempId: z.string(),
  kind: z.enum(["character", "location", "item"]),
  profile: z.record(z.string(), z.unknown()),
  status: z.enum(["proposed", "accepted", "rejected", "merged"]),
  materializedEntityId: z.number().optional(),
  mergedIntoEntityId: z.number().optional(),
});

const entitySetPayloadSchema = z.object({
  candidates: z.array(candidateSchema),
});

/** Подпись кандидата. Раньше при отсутствии `name` в списке принятых
 *  персонажей стояло шесть строк «Без имени», из которых нельзя понять,
 *  кто есть кто. Берём первое осмысленное поле профиля и помечаем, что
 *  имени нет — оно дозаполняется на этапе, а не выдумывается тут. */
export function candidateLabel(profile: {
  name?: string;
  role?: string;
  type?: string;
  description?: string;
}): { text: string; unnamed: boolean } {
  const name = profile.name?.trim();
  if (name) return { text: name, unnamed: false };
  const fallback = (profile.role ?? profile.type ?? profile.description ?? "")
    .trim()
    .split(/(?<=[.!?])\s|\n/)[0]
    ?.trim();
  return {
    text: fallback && fallback.length > 0 ? fallback.slice(0, 60) : "Кандидат",
    unnamed: true,
  };
}

function UnnamedFlag() {
  return (
    <span
      className="text-xs text-[var(--color-ink-amber)] ml-2"
      title="У кандидата нет имени — задайте его перед материализацией"
    >
      имя не задано
    </span>
  );
}

function renderCandidate(
  c: EntitySetPayload["candidates"][number],
): React.ReactNode {
  const profile = c.profile as {
    name?: string;
    role?: string;
    type?: string;
    description?: string;
  };
  const label = candidateLabel(profile);
  return (
    <li key={c.tempId} className="flex flex-col gap-0.5">
      <span className="text-sm font-medium">
        {label.text}
        {label.unnamed && <UnnamedFlag />}
        {profile.role && (
          <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
            {profile.role}
          </span>
        )}
        {profile.type && (
          <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
            {profile.type}
          </span>
        )}
      </span>
      {profile.description && (
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {profile.description}
        </span>
      )}
    </li>
  );
}

export function createEntityAdapter(
  stageId: "characters" | "items",
): StageAdapter<EntitySetPayload> {
  return {
    stageId,
    payloadKind: "entity_set",
    payloadSchema: entitySetPayloadSchema,
    renderVariant: (payload) => (
      <ul className="flex flex-col gap-2 pl-2">
        {payload.candidates.map(renderCandidate)}
      </ul>
    ),
    renderFinal: (payload) => (
      <ul className="flex flex-col gap-2 rounded bg-[var(--color-muted)] px-3 py-2">
        {payload.candidates
          .filter((c) => c.status === "accepted" || c.status === "merged")
          .map((c) => {
            const profile = c.profile as {
              name?: string;
              role?: string;
              type?: string;
              description?: string;
            };
            const label = candidateLabel(profile);
            const idChip = c.materializedEntityId
              ? `#${c.materializedEntityId}`
              : c.mergedIntoEntityId
                ? `→ #${c.mergedIntoEntityId}`
                : "";
            return (
              <li key={c.tempId} className="text-sm">
                {label.text}{" "}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {idChip}
                </span>
                {label.unnamed && <UnnamedFlag />}
              </li>
            );
          })}
      </ul>
    ),
  };
}
