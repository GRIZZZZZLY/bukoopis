import { useSearchParams } from "react-router-dom";
import { useBookRoom } from "@/components/book/BookLayout";
import { CharacterCanon } from "@/components/book/CharacterCanon";
import {
  HooksTab,
  ItemsTab,
  LocationsTab,
  RelationshipsTab,
} from "@/components/book/CanonTabs";

const TABS = [
  { id: "characters", label: "Персонажи" },
  { id: "items", label: "Предметы" },
  { id: "places", label: "Места" },
  { id: "hooks", label: "Крючки" },
  { id: "relations", label: "Связи" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Канон — единственное место, где правится мир книги. Мастерская только
 *  предлагает и утверждает; глава только ссылается сюда. Вкладка живёт в
 *  адресе (?tab=), чтобы ссылка «Править в Каноне» вела прямо на неё. */
export function BookCanonPage() {
  const { bookId } = useBookRoom();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "characters";

  return (
    <div className="route canon-sec">
      <div className="tabs-bar">
        <div role="tablist" aria-label="Разделы канона" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`canon-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="canon-panel"
              className={`tab ${tab === t.id ? "tab-active" : ""}`}
              onClick={() => setParams(t.id === "characters" ? {} : { tab: t.id }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="faint">Единственное место, где правится мир книги</span>
      </div>
      <div id="canon-panel" role="tabpanel" aria-labelledby={`canon-tab-${tab}`} className="canon-panel">
        {tab === "characters" && <CharacterCanon bookId={bookId} />}
        {tab === "items" && <ItemsTab bookId={bookId} />}
        {tab === "places" && <LocationsTab bookId={bookId} />}
        {tab === "hooks" && <HooksTab bookId={bookId} />}
        {tab === "relations" && <RelationshipsTab bookId={bookId} />}
      </div>
    </div>
  );
}
