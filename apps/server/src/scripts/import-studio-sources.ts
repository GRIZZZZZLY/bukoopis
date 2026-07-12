/* eslint-disable no-console */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { streamText } from "@book-forge/llm";
import {
  studioStateSchema,
  bookConceptSchema,
  emptyStudioState,
  assertStudioStateInvariants,
  type BookConcept,
  type StageAspect,
  type AspectVariant,
  type StudioState,
  type StageState,
  type CharacterProfile,
  type EntitySetPayload,
  type EntityCandidate,
} from "@book-forge/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Paths ───
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEFAULT_IMPORT_DIR = path.join(REPO_ROOT, "import");
const DEFAULT_DB_PATH = path.join(REPO_ROOT, "data", "db.sqlite");

// ─── CLI ───
function arg(name: string, fallback?: string): string | undefined {
  const ix = process.argv.indexOf(`--${name}`);
  if (ix !== -1 && process.argv[ix + 1]) return process.argv[ix + 1];
  return fallback;
}

// Load .env from apps/server (where ANTHROPIC_API_KEY lives).
dotenv.config({ path: path.join(REPO_ROOT, "apps", "server", ".env") });

const IMPORT_DIR = arg("import-dir", process.env.IMPORT_DIR ?? DEFAULT_IMPORT_DIR)!;
const DB_PATH = arg("db", process.env.DB_PATH ?? DEFAULT_DB_PATH)!;
const TITLE = arg("title", "Соляной архив")!;
const EXISTING_BOOK_ID = (() => {
  const v = arg("book-id");
  return v ? Number(v) : undefined;
})();
const SKIP_REWRITE = process.argv.includes("--skip-rewrite");
const REWRITE_MODEL: "sonnet" | "opus" =
  arg("model", "sonnet") === "opus" ? "opus" : "sonnet";

// ─── Concept (contest pivot — combo #1+#4+#8: соляной архив + биомные импланты + солёный лёд) ───
const CONCEPT: BookConcept = {
  schemaVersion: 1,
  genres: ["научная фантастика", "технологический экшен"],
  tones: ["тёмный", "инженерный", "психологический"],
  audience: "adult",
  premise: {
    protagonist:
      "Джасра Вент — пустынный метролог-инженер, мастер чтения соляных пластов; нанята как калибровщик в редкую совместную экспедицию воды и пустыни.",
    conflict:
      "Третья экспедиция поднимает с глубины «солёный лёд», который не плавится и пульсирует. Расшифровав первый кристалл, Джасра читает регистр био-сегрегации: имена, биомы, год выбраковки. В списке — она сама, её водный напарник и четверо команды. На поверхности шестерых уже ждут обе стороны.",
    stakes:
      "Если код вытащить наверх целиком — фабрика биомных имплантов превратится в инструмент массовой выбраковки. Если уничтожить — погибнет вся метрология последних двух веков. Шестеро должны выбрать: вынести, уничтожить или переписать.",
    logline:
      "Когда совместная экспедиция воды и пустыни поднимает с глубины пульсирующий солёный лёд, инженер-метролог Джасра Вент читает в его кристаллической решётке регистр: кто из людей какому биому «положен», и кого следующего вычеркнут. В списке — её имя.",
  },
};

// ─── Synopsis used to brief LLM rewriter ───
const SYNOPSIS_3ACT = `## Трёхактная сборка книги 1
**Акт I. Контракт.** Найм шестёрки. Первое погружение. Поднимают «лёд», он пульсирует. Джасра против протокола (её зовут читать пласт без верификации). Селена знает, что заказчик — не тот, кем представляется.
**Акт II. Расшифровка.** Джасра читает первый кристалл — регистр имён. Параллельно: имплант Сарека даёт сбой в воде. Связь: импланты сделаны из этой же соли. Команда раскалывается: вынести → дать оружие массовой выбраковки. Уничтожить → убить метрологию мира.
**Акт III. Калибровка наверху.** Засада на платформе. Часть «льда» вырывается из контейнера. Финал: Джасра ручной калибровкой переписывает фрагмент кода — биом-привязка перестаёт быть фатальной (имплант теперь просто слабее в чужой среде, не убивает). Цена: Сарек закрывает периметр без брони, Рахир уходит в «тихий профиль» навсегда. Шестеро объявлены вне закона обеими сторонами. Зацепка в книгу 2: один из кристаллов всплывёт у третьей фракции.`;

// ─── File → stage mapping ───
interface FileSpec {
  file: string;
  name: string;
  description?: string;
}

const WORLD_FILES: FileSpec[] = [
  {
    file: "Происхождение-барьера-древние-эпохи.md",
    name: "Происхождение Соляного Архива",
    description:
      "Каноническая физика мира. Глубинный соляной слой как носитель древнего кода био-сегрегации. Барьер — фоновая физическая граница биомов, не ядро.",
  },
  {
    file: "Карта-и-маршруты.md",
    name: "География и маршруты",
    description:
      "Двойственный мир: водная сторона ↔ соляно-пустынная. Глубинные точки добычи, ритуальные коридоры, серые зоны, узлы переходов.",
  },
  {
    file: "Связь-и-переходы-через-Барьер.md",
    name: "Переходы и связь между биомами",
    description:
      "Правила перехода через биомную границу. Импланты-производные соли работают в одном биоме и отказывают в другом.",
  },
];

const LORE_FILES: FileSpec[] = [
  {
    file: "Ограничения-и-цена-технологий.md",
    name: "Ограничения и цена технологий",
    description: "Канон-запреты: никакого «спасения одним артефактом».",
  },
  {
    file: "Пищевая-экономика-воды-и-пустыни.md",
    name: "Пищевая экономика",
    description: "Производство, дефициты, торговля едой между мирами.",
  },
  {
    file: "Повседневные-блюда-воды-и-пустыни.md",
    name: "Повседневная кухня",
    description: "Блюда воды и пустыни — фактура быта.",
  },
  {
    file: "03_Тайны-и-пазлы.md",
    name: "Тайны и пазлы",
    description: "Открытые тайны книги 1, расшифровка по матрице раскрытия.",
  },
  {
    file: "04_Что-реально-правда-к-концу-книги-1.md",
    name: "Канон правды к концу К1",
    description: "Что считается подтверждённым каноном к финалу книги 1.",
  },
];

const PLOT_FILES: FileSpec[] = [
  {
    file: "00_Оглавление-книги-1.md",
    name: "Оглавление книги 1",
    description: "10 глав: POV, цель, конфликт, выбор, цена, крючок.",
  },
  {
    file: "05_Матрица-раскрытия-тайн-по-главам.md",
    name: "Матрица раскрытия тайн",
    description: "Какая тайна раскрывается в какой главе.",
  },
];

// ─── Contest pivot brief (extra lore aspect) ───
const PIVOT_MARKDOWN = `# Конкурсный пивот: соляной архив (комбо #1+#4+#8)

## Каноническая физика мира
- **Глубинный соляной слой** — носитель древнего кода. Био-минеральный архив, в кристаллической решётке которого записан реестр био-сегрегации человечества: какому биому какой человек «совместим». Источник записи неустановлен (зацепка в книгу 2).
- **Солёный лёд** — фрагменты архива, поднимаемые с глубины. Не плавятся при стандартных температурах. Пульсируют (период ≈73 минуты, амплитуда зависит от биом-профиля наблюдателя). Реагируют на присутствие людей разной биом-привязки.
- **Биомные импланты** — производные обработанной соли архива. Работают в одном биоме, отказывают (а в крайних случаях — детонируют) в другом. Деление человечества на «водных» и «пустынных» носителей — не природное, а инженерно спроектированное предками.
- **Барьер** — опциональная фоновая деталь, не ядро сюжета. Физическая граница биомов: атмосферно-плотностной градиент, давление, температурный разрыв. Не мистический, не «живой».
- **Шёпот-цепочки** — устаревшая инженерная сеть передачи данных через резонанс соляных пластов.
- **Ритуалы навигаторов** — устная мнемотехника инженерных протоколов чтения соли.

## POV-перевес под конкурс
- Джасра Вент — 45% (метролог соли, центральный фокальный персонаж).
- Селена Корт — 20% (контрабандистка воды, связь с заказчиком и наземкой).
- Сарек Ил'Ван — 15% (периметр, психология вины выжившего).
- Остальные (Рин, Рахир, Нейла) — 20%.

## Жюри-фильтры
- **Сурдин (физик):** кристаллография соли архива, температурные окна стабильности кристаллов, давление декомпрессии при глубинной добыче, частоты пульсации (Гц), акустика соляных пластов.
- **Васильев (фантаст):** физическое действие в каждой главе, тёмный тон, цена решений, потери. Финал — частное решение, не «спасение мира».
- **Прядеев (психолог):** Сарек (вина выжившего); Рахир (страх стать машиной — углубляется, потому что его имплант — производное архива); Джасра (детский опыт «эмоций как ошибки» рушится, когда читает собственное имя в реестре).
- **Горинова (АСТ):** аннотация 800 знаков должна продавать книгу за 30 секунд; жанровый якорь, ставка, локация, конфликт.

## Запреты
- Никаких попаданцев, ЛитРПГ, академок.
- Никакого «спасения мира одним артефактом».
- Никакого магического реализма — соляной архив объясняется через кристаллографию + информатику.
- Никакой прямой политической публицистики; биом-сегрегация — метафора, а не лобовая аналогия.

## Целевые номинации
1. **Крупная проза. Роман** — основная.
2. **Начало научно-фантастической серии** — отметка при подаче.
3. **Лучшая футуристическая технология (Минпромторг)** — соляной кристаллический архив как фикциональная технология.
4. **Соавторство «Охотник за БПЛА»** — отдельный рассказ-приквел из этой вселенной.

## Дедлайны (сезон 2026)
- Приём заявок: 04.03.2026 — 31.05.2026.
- Публикация на Литрес Авторы: не позже 25.05.2026 (запас на модерацию).

${SYNOPSIS_3ACT}
`;

// ─── Characters (parsed from Связи-и-конфликты) ───
interface CharSeed {
  canonicalName: string;
  profile: CharacterProfile;
}

const CHARACTERS: CharSeed[] = [
  {
    canonicalName: "Джасра Вент",
    profile: {
      description:
        "Пустынный метролог-инженер, мастер чтения соляных пластов. Точна, рациональна, плохо терпит расплывчатые компромиссы. Центральный фокальный персонаж (45% POV) — её ремесло читать кристаллическую решётку и есть точка входа в загадку соляного архива.",
      want: "Откалибровать «солёный лёд» по протоколу и закрыть контракт совместной экспедиции — научно и без скандала.",
      need: "Принять, что не все системы калибруются цифрами; что доверие людям может быть рациональным выбором — особенно когда читаешь своё имя в чужом реестре.",
      lie: "«Эмоции — это шум. Чистый расчёт всегда даёт верный результат.» Детский опыт, где «эмоции» стоили жизни семье.",
      arc: "Точка нарушения: проводит ручную перекалибровку фрагмента кода в кристалле без полной верификации, чтобы остановить фабрику биомных имплантов как оружия выбраковки. Потеря к финалу К1: научная репутация и доступ к официальным метрологическим архивам обеих сторон.",
      notes:
        "Скрывает: часть сенсорных ключей нелегального происхождения. Доверяет данным и Рахиру; не доверяет «традиционным трактовкам». Знает, что её имя стоит в регистре био-выбраковки.",
    },
  },
  {
    canonicalName: "Нейла Корус",
    profile: {
      description:
        "Навигатор водной стороны и хранительница памяти рода. Единственная, кто умеет вести судно через глубинные течения над аномальной зоной добычи. Опора на традицию, страх утраты истины.",
      want: "Удержать рабочие маршруты воды и довести судно над глубинной точкой добычи без потерь.",
      need: "Признать, что устные мнемотехники её рода — фрагменты тех же инженерных протоколов чтения соли, что и у Джасры, и научиться объединять методы.",
      lie: "«Кодекс рода никогда не подведёт» — пока не предал.",
      arc: "Точка нарушения: выбирает живое наблюдение глубинного течения вместо ритуальной карты и спасает судно при первом погружении. Потеря к финалу К1: статус «безупречной хранительницы», доверие старших навигаторов.",
      notes:
        "Скрывает масштабы расхождений в картах рода. Частично доверяет Рину; не доверяет совету Конклава.",
    },
  },
  {
    canonicalName: "Рин Даре",
    profile: {
      description:
        "Капитан с грузом прошлой ошибки. Держит дисциплину, но сомневается в приказах сверху.",
      want: "Довести людей живыми и вернуть репутацию капитана.",
      need: "Простить себя за прошлую миссию и научиться нарушать приказы, когда они врут.",
      lie: "«Прямой приказ в критической операции — выше моей оценки ситуации.»",
      arc: "Точка нарушения: игнорирует фальшивый приказ на отход и прикрывает эвакуацию. Потеря к финалу К1: официальный ранг и мандат командования.",
      notes:
        "Скрывает реальную причину катастрофы в прошлой экспедиции. Доверяет боевикам поля; не доверяет политическим кураторам.",
    },
  },
  {
    canonicalName: "Селена Корт",
    profile: {
      description:
        "Контрабандистка водной стороны с выживаческой этикой. Гибкая, циничная, внимательная к слабым местам систем. Связной экспедиции с заказчиком и наземной разведкой; вторая по объёму POV (~20%).",
      want: "Выжить и не дать обеим фракциям закрыть серые маршруты, через которые проходит соль архива.",
      need: "Поверить, что коллективная цель может быть не ловушкой, а опорой — особенно когда заказчик оказывается тем, кто планировал выбраковку.",
      lie: "«Высоких целей не бывает — есть только чужие интересы под красивым флагом.»",
      arc: "Точка нарушения: отдаёт ключевой канал связи и сжигает связь с заказчиком, чтобы предупредить команду о засаде на платформе. Потеря к финалу К1: контроль над собственным каналом контрабанды.",
      notes:
        "Скрывает сделки с посредниками крепости. Ситуативно доверяет Нейле; не доверяет Аль-Мурге. Её имя стоит в регистре био-выбраковки рядом с именем Джасры.",
    },
  },
  {
    canonicalName: "Рахир Дал",
    profile: {
      description:
        "Носитель тяжёлых биомных имплантов — производных обработанной соли архива. Балансирует между функциональностью и потерей «человечности». Профессиональная сцепка с Джасрой (железо + кристаллография). Ходячее доказательство связи соли архива и тел.",
      want: "Сохранить функциональность имплантов и довести пустынную часть отряда.",
      need: "Принять, что часть человечности уже потеряна — и что это не делает его машиной.",
      lie: "«Если я отключу контур — я перестану быть собой.»",
      arc: "Точка нарушения: уходит в «тихий профиль» при выходе на платформу, чтобы не спровоцировать пульсацию контейнера со «льдом». Финал — переход в постоянный «тихий профиль» ценой моторики, чтобы дать Джасре время на ручную калибровку.",
      notes:
        "Скрывает критический параметр имплантов: при контакте с фрагментом архива его контур усиливает пульсацию кристалла. Доверяет Джасре в технике; не доверяет клановым старшим.",
    },
  },
  {
    canonicalName: "Сарек Ил'Ван",
    profile: {
      description:
        "Боец с травмой потери отряда. Внешне жёсткий, внутри — страх снова не уберечь своих. Ключевой персонаж под жюри-психолога Прядеева.",
      want: "Не допустить повторения гибели группы в новом составе.",
      need: "Признать, что спасти всех нельзя — и что это не делает его виновным.",
      lie: "«Если я в этот раз сделаю всё правильно — никто больше не умрёт.»",
      arc: "Точка нарушения: вынужден оставить тяжелораненого на минуту, чтобы закрыть периметр и спасти остальных. Потеря к финалу К1: иллюзия, что можно спасти всех.",
      notes:
        "Скрывает: знает имя куратора, отправившего его прошлую группу в ловушку. Доверяет полевому действию Рина; не доверяет кабинетным командирам.",
    },
  },
];

// ─── Helpers ───
function readSource(spec: FileSpec): string {
  const p = path.join(IMPORT_DIR, spec.file);
  if (!fs.existsSync(p)) {
    throw new Error(`source not found: ${p}`);
  }
  return fs.readFileSync(p, "utf-8");
}

function makeAcceptedMarkdownAspect(args: {
  id: string;
  name: string;
  description?: string;
  order: number;
  markdown: string;
  generatedAt: string;
  variantLabel?: string;
}): StageAspect {
  const variantId = `${args.id}-v1`;
  const variant: AspectVariant = {
    id: variantId,
    label: args.variantLabel ?? "Импорт",
    payloadKind: "markdown",
    payload: args.markdown,
    status: "accepted",
    editSource: "manual",
    generatedAt: args.generatedAt,
  };
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    status: "accepted",
    order: args.order,
    required: true,
    source: "import",
    payloadKind: "markdown",
    variants: [variant],
    selectedVariantId: variantId,
    finalPayload: args.markdown,
  };
}

function makeRewrittenMarkdownAspect(args: {
  id: string;
  name: string;
  description?: string;
  order: number;
  original: string;
  rewritten: string;
  generatedAt: string;
}): StageAspect {
  const v1Id = `${args.id}-v1`;
  const v2Id = `${args.id}-v2`;
  const v1: AspectVariant = {
    id: v1Id,
    label: "Исходник (черновик)",
    payloadKind: "markdown",
    payload: args.original,
    status: "superseded",
    editSource: "manual",
    generatedAt: args.generatedAt,
  };
  const v2: AspectVariant = {
    id: v2Id,
    label: "Конкурсная редакция (LLM rewrite)",
    payloadKind: "markdown",
    payload: args.rewritten,
    status: "accepted",
    editSource: "refine",
    parentVariantId: v1Id,
    generatedAt: args.generatedAt,
    modelId: REWRITE_MODEL,
  };
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    status: "accepted",
    order: args.order,
    required: true,
    source: "import",
    payloadKind: "markdown",
    variants: [v1, v2],
    selectedVariantId: v2Id,
    finalPayload: args.rewritten,
  };
}

// ─── LLM rewrite ───

const REWRITE_SYSTEM_PROMPT = `Ты редактор инженерной фантастики, готовящий черновики автора под конкурс «Инженеры слова — Проект особого значения» 2026 (АО ЗАСЛОН + Литрес + Минпромторг + Роскосмос).

КОНЦЕПЦИЯ КНИГИ (комбо #1+#4+#8: соляной архив + биомные импланты + солёный лёд):

ЛОГЛАЙН: ${CONCEPT.premise.logline}

ПРОТАГОНИСТ: ${CONCEPT.premise.protagonist}

КОНФЛИКТ: ${CONCEPT.premise.conflict}

СТАВКИ: ${CONCEPT.premise.stakes}

${SYNOPSIS_3ACT}

ТЕРМИНОЛОГИЯ КАНОНА (ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ):
- «Соляной архив» / «глубинный соляной слой» — носитель древнего кода био-сегрегации.
- «Солёный лёд» — фрагменты архива, поднимаемые с глубины. Не плавятся при стандартных температурах. Пульсируют (период ≈73 минуты).
- «Биомные импланты» — производные обработанной соли архива; работают в одном биоме, отказывают в другом.
- «Биом-привязка», «биомный профиль», «биомная сегрегация» — категории совместимости человека с водной или соляно-пустынной средой.
- Двойственность мира: водная сторона ↔ соляно-пустынная сторона.

КОГДА В ИСХОДНИКЕ ВСТРЕЧАЕТСЯ «БАРЬЕР» КАК ЯДРО КАНОНА:
- НЕ удаляй слово «Барьер» полностью — но низведи его до фоновой физической границы биомов (атмосферно-плотностной градиент, давление, температурный разрыв). Не «живой», не мистический.
- Все ключевые объяснения, которые в черновике опираются на «свойства Барьера», переведи на свойства соляного архива и биомной сегрегации.
- Если у автора есть «Версия 2 — резонансный терраформер» как объяснение Барьера, замени её объяснением «соляной архив как древний инженерный носитель кода»; «Версии 1 и 3» (мистика, заговор) — оставь как внутрисюжетную ложь героев.

ШЕСТЬ ПЕРСОНАЖЕЙ — ИМЕНА НЕИЗМЕННЫ:
Джасра Вент (метролог соли, главный POV), Нейла Корус (навигатор воды), Рин Даре (капитан), Селена Корт (контрабандистка воды), Рахир Дал (носитель биомных имплантов), Сарек Ил'Ван (боец).

ПРАВИЛА ПЕРЕРАБОТКИ:
1. СОХРАНИ структуру markdown точно: H1/H2/H3, списки, таблицы, код-блоки. Это нужно для UI Studio.
2. СОХРАНИ имена шестерых героев и их базовые роли.
3. СОХРАНИ географическую двойственность вода↔пустыня и факты быта (кухня, экономика, маршруты — почти не трогай, только убери барьер-зависимости).
4. УБЕРИ Барьер как ядро канона; ВВЕДИ соляной архив + биомные импланты + солёный лёд.
5. Перевод на инженерный язык: физические единицы (МПа, °C, Гц, мкВ, м/с), кристаллография, метрология, акустика. Никакой мистики и магии.
6. Под жюри:
   - Сурдин (физик): кристаллография, температурные окна, давление декомпрессии, частоты пульсации, акустика соляных пластов.
   - Васильев (фантаст): тёмный тон, цена решений, частное (не глобальное) разрешение конфликтов.
   - Прядеев (психолог): Сарек — вина выжившего; Рахир — страх стать машиной (его имплант — производное архива); Джасра — детский опыт «эмоций как ошибки».
7. Запреты: попаданчество, ЛитРПГ, академки, спасение мира одним артефактом, магический реализм, прямая политическая публицистика.

ФОРМАТ ОТВЕТА:
Верни ТОЛЬКО переписанный markdown. БЕЗ преамбулы, БЕЗ «вот результат», БЕЗ метакомментариев в конце. Только содержимое файла.`;

interface RewriteContext {
  enabled: boolean;
}

async function rewriteWithLLM(
  ctx: RewriteContext,
  spec: FileSpec,
  stageId: string,
  original: string,
): Promise<string> {
  if (!ctx.enabled) return original;
  const userMsg = `# Файл: \`${spec.file}\`
# Стадия Studio: \`${stageId}\` → аспект «${spec.name}»
# Описание аспекта: ${spec.description ?? "(нет)"}

## ИСХОДНЫЙ MARKDOWN

${original}`;
  console.log(`  [llm] rewriting ${spec.file} (${original.length} chars)...`);

  // streamText routes through subscription backend (claude-agent-sdk)
  // for agent "aspect_refine" — see packages/llm/src/router.ts.
  const gen = streamText({
    agentName: "aspect_refine",
    model: REWRITE_MODEL,
    system: REWRITE_SYSTEM_PROMPT,
    prompt: userMsg,
    maxTokens: 16384,
  });

  let full = "";
  let final: Awaited<ReturnType<typeof gen.next>>["value"] | undefined;
  while (true) {
    const next = await gen.next();
    if (next.done) {
      final = next.value;
      break;
    }
    full += next.value;
  }
  if (!final) throw new Error(`stream returned no final result for ${spec.file}`);

  const out = (typeof final === "object" && "text" in final ? final.text : full).trim();
  if (out.length < 100) {
    throw new Error(`LLM output suspiciously short for ${spec.file}: "${out.slice(0, 200)}"`);
  }
  const usage =
    typeof final === "object" && "inputTokens" in final
      ? `${final.inputTokens}→${final.outputTokens} tokens`
      : "tokens n/a";
  console.log(`  [llm] ✓ ${spec.file}: ${out.length} chars, ${usage}`);
  return out;
}

function slugifyAspectId(stageId: string, name: string, idx: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${stageId}-${idx + 1}-${slug || "aspect"}`;
}

async function buildMarkdownStage(
  stageId: string,
  specs: FileSpec[],
  generatedAt: string,
  ctx: RewriteContext,
  extraAspects: StageAspect[] = [],
): Promise<StageState> {
  const aspects: StageAspect[] = [];
  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx]!;
    const id = slugifyAspectId(stageId, spec.name, idx);
    const original = readSource(spec);
    if (ctx.enabled) {
      let rewritten: string | undefined;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          rewritten = await rewriteWithLLM(ctx, spec, stageId, original);
          break;
        } catch (e) {
          const msg = (e as Error).message;
          if (attempt < MAX_ATTEMPTS) {
            console.warn(
              `  [llm] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${spec.file}: ${msg}. Retrying...`,
            );
          } else {
            console.warn(
              `  [llm] FAILED ${spec.file} after ${MAX_ATTEMPTS} attempts: ${msg}. Falling back to raw import.`,
            );
          }
        }
      }
      if (rewritten !== undefined) {
        aspects.push(
          makeRewrittenMarkdownAspect({
            id,
            name: spec.name,
            description: spec.description,
            order: idx,
            original,
            rewritten,
            generatedAt,
          }),
        );
        continue;
      }
    }
    aspects.push(
      makeAcceptedMarkdownAspect({
        id,
        name: spec.name,
        description: spec.description,
        order: idx,
        markdown: original,
        generatedAt,
      }),
    );
  }
  for (const extra of extraAspects) {
    aspects.push({ ...extra, order: aspects.length });
  }
  return {
    status: "complete",
    playbookGenerated: true,
    aspects,
    updatedAt: generatedAt,
  };
}

function insertCharacters(
  sqlite: Database.Database,
  bookId: number,
  now: string,
): { tempId: string; entityId: number; profile: CharacterProfile; name: string }[] {
  const stmt = sqlite.prepare(
    `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  return CHARACTERS.map((c, idx) => {
    const info = stmt.run(
      bookId,
      c.canonicalName,
      JSON.stringify(c.profile),
      now,
      now,
    );
    return {
      tempId: `import-char-${idx + 1}`,
      entityId: Number(info.lastInsertRowid),
      profile: c.profile,
      name: c.canonicalName,
    };
  });
}

function buildCharactersStage(
  materialized: { tempId: string; entityId: number; profile: CharacterProfile; name: string }[],
  generatedAt: string,
): StageState {
  const candidates: EntityCandidate[] = materialized.map((m) => ({
    tempId: m.tempId,
    kind: "character",
    profile: { canonicalName: m.name, profile: m.profile },
    status: "accepted",
    materializedEntityId: m.entityId,
  }));
  const payload: EntitySetPayload = { candidates };
  const variantId = "characters-import-v1";
  const variant: AspectVariant = {
    id: variantId,
    label: "Импорт шестёрки",
    payloadKind: "entity_set",
    payload,
    status: "accepted",
    editSource: "manual",
    generatedAt,
  };
  const aspect: StageAspect = {
    id: "characters-1-import",
    name: "Импорт шестёрки персонажей",
    description: "Шесть POV-героев книги 1 из исходных заметок.",
    status: "accepted",
    order: 0,
    required: true,
    source: "import",
    payloadKind: "entity_set",
    variants: [variant],
    selectedVariantId: variantId,
    finalPayload: payload,
    emits: {
      kind: "character",
      entityIds: materialized.map((m) => m.entityId),
    },
  };
  return {
    status: "complete",
    playbookGenerated: true,
    aspects: [aspect],
    updatedAt: generatedAt,
  };
}

function buildConceptStage(generatedAt: string): StageState {
  const summary = [
    `Жанры: ${CONCEPT.genres.join(", ")}`,
    `Тон: ${CONCEPT.tones.join(", ")}`,
    `Аудитория: ${CONCEPT.audience}`,
    "",
    `**Протагонист.** ${CONCEPT.premise.protagonist}`,
    "",
    `**Конфликт.** ${CONCEPT.premise.conflict}`,
    "",
    `**Ставки.** ${CONCEPT.premise.stakes}`,
    "",
    `**Логлайн.** ${CONCEPT.premise.logline}`,
  ].join("\n");
  const aspect = makeAcceptedMarkdownAspect({
    id: "concept-1-pivot",
    name: "Концепт под «Инженеры слова» 2026",
    description: "Жанр, тон, премиса под конкурсный пивот.",
    order: 0,
    markdown: summary,
    generatedAt,
    variantLabel: "Конкурсный концепт",
  });
  return {
    status: "complete",
    playbookGenerated: true,
    aspects: [aspect],
    updatedAt: generatedAt,
  };
}

// ─── Main ───
async function main(): Promise<void> {
  console.log(`[import] DB: ${DB_PATH}`);
  console.log(`[import] sources: ${IMPORT_DIR}`);
  console.log(`[import] rewrite: ${SKIP_REWRITE ? "SKIPPED" : `ENABLED (model=${REWRITE_MODEL})`}`);
  if (!fs.existsSync(IMPORT_DIR)) {
    throw new Error(`import dir not found: ${IMPORT_DIR}`);
  }
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`db not found: ${DB_PATH}. Run pnpm migrate first.`);
  }

  // Subscription backend (claude-agent-sdk) doesn't need ANTHROPIC_API_KEY.
  const rewriteCtx: RewriteContext = { enabled: !SKIP_REWRITE };

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const now = new Date().toISOString();

  // ── Resolve / create book ──
  let bookId: number;
  if (EXISTING_BOOK_ID) {
    const row = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(EXISTING_BOOK_ID) as { id: number } | undefined;
    if (!row) throw new Error(`book ${EXISTING_BOOK_ID} not found`);
    bookId = row.id;
    console.log(`[import] reusing book ${bookId}`);
  } else {
    const info = sqlite
      .prepare(
        `INSERT INTO books (title, language, premise, status, writer_model, plot_model, critic_model, writer_provider, created_at, updated_at)
         VALUES (?, 'ru', ?, 'draft', 'opus', 'sonnet', 'sonnet', 'anthropic', ?, ?)`,
      )
      .run(TITLE, CONCEPT.premise.logline ?? null, now, now);
    bookId = Number(info.lastInsertRowid);
    console.log(`[import] created book ${bookId}: "${TITLE}"`);
  }

  // ── Concept ──
  bookConceptSchema.parse(CONCEPT);
  sqlite
    .prepare("UPDATE books SET concept = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(CONCEPT), now, bookId);
  console.log(`[import] concept set`);

  // ── Wipe existing studio_state for clean idempotent re-run ──
  if (EXISTING_BOOK_ID) {
    sqlite
      .prepare("UPDATE books SET studio_state = NULL WHERE id = ?")
      .run(bookId);
    sqlite
      .prepare("DELETE FROM characters WHERE book_id = ?")
      .run(bookId);
    console.log(`[import] cleared existing studio_state + characters`);
  }

  // ── Characters → DB ──
  const materialized = insertCharacters(sqlite, bookId, now);
  console.log(`[import] inserted ${materialized.length} characters`);

  // ── Build StudioState ──
  const pivotAspect = makeAcceptedMarkdownAspect({
    id: "lore-pivot-contest",
    name: "Конкурсный пивот: инженерная рамка",
    description:
      "Адаптация под конкурс «Инженеры слова» 2026: канон Барьера v2, POV-перевес, жюри-фильтры, антипатерны.",
    order: 0,
    markdown: PIVOT_MARKDOWN,
    generatedAt: now,
    variantLabel: "Пивот",
  });

  console.log(`[import] building stages...`);
  console.log(`[import] world (${WORLD_FILES.length} files):`);
  const worldStage = await buildMarkdownStage("world", WORLD_FILES, now, rewriteCtx);
  console.log(`[import] lore (${LORE_FILES.length} files + 1 pivot):`);
  const loreStage = await buildMarkdownStage("lore", LORE_FILES, now, rewriteCtx, [pivotAspect]);
  console.log(`[import] plot (${PLOT_FILES.length} files):`);
  const plotStage = await buildMarkdownStage("plot", PLOT_FILES, now, rewriteCtx);

  const next: StudioState = {
    schemaVersion: 1,
    revision: 0,
    stages: {
      concept: buildConceptStage(now),
      world: worldStage,
      lore: loreStage,
      characters: buildCharactersStage(materialized, now),
      plot: plotStage,
      // items / chapters — leave for later
    },
  };

  // ── Validate ──
  studioStateSchema.parse(next);
  assertStudioStateInvariants(next);

  sqlite
    .prepare("UPDATE books SET studio_state = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(next), now, bookId);

  // ── Audit event ──
  sqlite
    .prepare(
      `INSERT INTO studio_events
         (book_id, event_type, stage_id, aspect_id, payload, revision_before, revision_after, created_at)
       VALUES (?, 'import_merge', NULL, NULL, ?, 0, 0, ?)`,
    )
    .run(
      bookId,
      JSON.stringify({
        note: "import-studio-sources script",
        after: {
          stages: Object.keys(next.stages),
          characters: materialized.map((m) => ({ id: m.entityId, name: m.name })),
        },
      }),
      now,
    );

  // ── Verify ──
  const reloaded = studioStateSchema.parse(
    JSON.parse(
      (
        sqlite
          .prepare("SELECT studio_state FROM books WHERE id = ?")
          .get(bookId) as { studio_state: string }
      ).studio_state,
    ),
  );

  console.log(`[import] verify OK. revision=${reloaded.revision}`);
  for (const [stageId, st] of Object.entries(reloaded.stages)) {
    if (!st) continue;
    console.log(`  ${stageId.padEnd(12)} status=${st.status} aspects=${st.aspects.length}`);
  }

  console.log(`\n[import] DONE. Open: http://localhost:5173/books/${bookId}/studio`);
  sqlite.close();
}

main().catch((e) => {
  console.error("[import] FAILED:", e);
  process.exit(1);
});
