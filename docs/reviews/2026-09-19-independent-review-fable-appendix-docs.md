# Зона G — документация против кода, миграции, схема (отчёт субагента, сохранён вручную)

Опорные факты: AGENT_NAMES = 26 (packages/llm/src/types.ts:26-53), STRUCTURED_AGENT_NAMES = 20 (:71-92); MODEL_IDS = { sonnet: "claude-sonnet-4-6", opus: "claude-opus-5" } (pricing.ts:13-16); DEFAULT_AGENT_BACKEND (router.ts:9-36): критики/canon_guard/plot_*/lore/character/style_* → api, остальные → subscription (CLAUDE.md верен); 7 этапов; app.ts:60-75 монтирует 15 роутеров; engines.node ">=22", .nvmrc 22.

## Расхождения документации и кода (47 строк; ADR 0002 согласован)
| Документ | Где | Документ говорит | В коде |
|---|---|---|---|
| README.md | :19 | «последние три главы целиком» | rolling-context.ts:29-37,61,113 — три последние главы идут САММАРИ (v.summary, иначе первые 1200 символов); дословно только хвост предыдущей ≤6000 (:119-135) |
| README.md | :63 | пример /api/health {status,timestamp,db} | health.ts:27-32 отдаёт ещё vec |
| README.md | :36 | «pnpm 10+» | нет packageManager/engines.pnpm |
| docs/migrations.md | :41-42 | «Each migration runs in its own transaction» | drizzle-orm sqlite-core/dialect.js:580-595 — один BEGIN…COMMIT на весь пакет непримененных |
| docs/migrations.md | :18-19 | schema.ts = документация текущей формы | 29 таблиц против 31 в SQL; нет book_meta_summaries, book_notes, book_facts.origin, uq_memory_jobs_version_kind, uq_entity_aliases_alias; books.style_profile_id в schema.ts onDelete "set null", в SQL 0005 — NO ACTION |
| docs/zod-4-migration.md | :32-35 | «157 tests… agents/style-engine/retrieval have no test suites» | 1330; agents 94, style-engine 40 (документ не помечен историческим) |
| docs/adr/0001 | :35, :88 | «Migrations: drizzle-kit… source of truth» | рукописный SQL (scripts/new-migration.ts:4-8); ADR не superseded |
| docs/adr/0001 | :59 | «shadcn — only Button scaffolded» | components/ui/: AlertDialog, Sheet, Skeleton, Tabs, button, card, dot, kbd, pill, progress |
| docs/adr/0001 | :9 | «8-agent pipeline coordinated by LangGraph» | графы есть (graphs/*.ts), но @langchain/langgraph-checkpoint-sqlite (server/package.json:26) в .ts не упоминается |
| docs/adr/0003 | :60 | MAX_WRITER_CONTEXT_TOKENS=80k | context-compiler.ts:21 MAX_PROSE_CONTEXT_TOKENS = 80_000 |
| docs/adr/0003 | :63-70 | слайс 3b: pov-context.ts, loadPovKnowledge, character_knowledge | файла/функции нет; знание — character_events (0023) |
| project-brief | :23, :89 | «~300 тестов» | 1330 |
| project-brief | :48 | «Агенты (~22)» (23 имени) | 26; нет pitch_generator, pitch_blender, material_classifier, style_blender; metaSummarize — не агент (meta-summarizer.ts:64 streamText под agentName "summarizer") |
| project-brief | :54 | «реестр жанров (16) + тонов (9)» | каталогов нет; playbook.ts:62 `Жанр: ${concept.genre ?? "не задан"}` |
| project-brief | :69 | «3 главы саммари дословно + ОДИН мета-роллап» | миграция 0025 + rolling-context.ts:71-78 — сводка на каждый рубеж, fingerprint (0024) |
| project-brief | :74 | character_knowledge + pov-context.ts | заменено событиями |
| project-brief | :19 | писатель claude-opus-5 | СОВПАДАЕТ с pricing.ts:15; устарел CLAUDE.md |
| architecture-overview | §2 | Writer = claude-opus-4-7 | pricing.ts:15 claude-opus-5 |
| architecture-overview | §4 | 13 роутов; «без глобального error-middleware» | app.ts:73,75 writing-progress/proposals; app.ts:49 app.onError |
| architecture-overview | §5 | 22 агента; списки бэкендов | 26; нет pitch_generator/pitch_blender/material_classifier (subscription), style_blender (api) |
| architecture-overview | §5, §10 | «на subscription-бэкенде ретраев НЕТ» | mcp-submit-tool.ts:310 withRetry(runOnce, {isRetryable: isTransientLlmError}) |
| architecture-overview | §7 | экстракторы fire-and-forget, нет очереди | memory_jobs (0014), memory-queue.ts (MEMORY_PIPELINE_VERSION 2, backoff, MEMORY_MAX_ATTEMPTS 5), memory-worker.ts, memory-activation.ts |
| architecture-overview | §7, §9 | finalize-gate, автосейв = версия finalize:false | chapter_drafts (0014) + PUT /chapters/:id/draft; флаг убран (chapter-version.ts:40) |
| architecture-overview | §8 | схема БД до 0013 | нет partial (0021), revision/profile_json (0022), kind/blend_config_json (0019); отсутствуют 9 таблиц 0014–0026 |
| architecture-overview | §10 | «фильтр book_id после KNN» | db/virtual.ts:27-36 — book_id метадата vec0 внутри MATCH |
| architecture-overview | §10 | «материализация — цикл INSERT без транзакции» | studio.ts:1407-1509 одна immediate-транзакция + событие |
| architecture-overview | §11, §10 | 22 агента, ~364 теста, ChapterPage ~1080 строк | 26; 1330; 1331 строка |
| architecture-overview | §12 | «промпты извлечены дословно» | inline.ts:29 intensify переписан; playbook.ts:62; writer.ts:122 архитектура; critics/base.ts:58 CRITIC_CALIBRATION_RULE — приложение устарело |
| architecture-overview | §1 vs §2/§5 | «Подписка НЕ оплачивает…» vs «zero-cost» | внутреннее противоречие; код помечает zero-cost |
| docs/PLAN.md | весь | пред-кодовый план без пометки «исторический»: Vercel AI SDK, tokenizer, chokidar, epub2, Langfuse, voyage-3; apps/obsidian-plugin; Sonnet 4.5/Opus 4.7/8 агентов; таблицы Arc/Scene/Decision/AuditReport/SceneSummary/Embedding; SqliteSaver/time-travel; двуязычие; GenerationConfig с temperature_override/branching_label; «Claude Pro бесплатно» | ни одного из пакетов; только RU; таблиц нет; чекпоинтера нет; ONNX Xenova/paraphrase-multilingual-MiniLM-L12-v2 (onnx-provider.ts:19) |
| CLAUDE.md | Locked decisions | «claude-opus-4-7 (Writer)» | pricing.ts:15 claude-opus-5 |
| CLAUDE.md | Routes | 13 маршрутов | +writing-progress, proposals |
| CLAUDE.md | Frontend | «characters\|items → EntityStagePage, otherwise MarkdownStagePage» | App.tsx:56 plot → PlanStagePage |
| CLAUDE.md | Memory layers | triggerVersionSummary (utils/summary-trigger.ts), fire-and-forget; «last 3 chapters verbatim + one rollup» | файла нет; очередь memory_jobs; саммари, роллапов несколько (тот же CLAUDE.md позже это исправляет) |
| CLAUDE.md | Memory-only agents | «metaSummarize follows the standard contract+bootstrap path» | не в AGENT_NAMES; свободнотекстовый вызов под summarizer |
| CLAUDE.md | MVP scope / Frontend | «8 agents»; «only Button scaffolded» | 26; 10 файлов ui |

## Оценка Jev — кратко
Верно: реранкер выключен (RETRIEVAL_RERANK=1, rerank.ts:8-45); canon_guard/critic_canon → api на books.critic_model; normalizeEventData, INTAKE_TARGETS, pricing.test.ts, usageLogger, resolveEntityDetailed ambiguous. Неточно: «реранкер выключен из-за цены» — код: «включить после бенчмарка на реальной книге» (rerank.ts:6-7). Не проверяемо: цена/лимиты/имя модели Jev, качество RU.

## Миграции
- 27 записей журнала ↔ 27 .sql; when строго возрастает (new-migration.ts:57 держит max(Date.now(), last+1)); мигратор применяет только `created_at(последней) < folderMillis` (dialect.js:583).
- Транзакционность: один BEGIN на пакет, ROLLBACK при ошибке (dialect.js:580,592-595) — docs/migrations.md:41 неверен.
- Идемпотентность: ни одна миграция не идемпотентна (CREATE без IF NOT EXISTS; ALTER ADD COLUMN в 0001,0005,0007,0009,0010,0014,0015,0018,0019,0020,0022,0024,0026); 0014 UPDATE origin='legacy', 0023 INSERT…SELECT при повторе удвоит перенос (NULL source_version_id вне уникального индекса). Приемлемо только благодаря __drizzle_migrations.
- Косметика: 0017_writing_days.sql:1 «Migration 0016_writing_days»; 0023:2-3 шаблон скаффолда.
- FK (проверено на :memory: с foreign_keys=ON): каскад chapters→chapter_versions с parent_version_id NO ACTION проходит; прямого DELETE версии в рантайме нет.
- Без FK на books: _health, style_profiles, writing_days — по замыслу.
- Легаси: character_knowledge мёртвая (намеренно); hooks живая (entities.ts:370-473, canon-extraction.ts:171, CanonPanel/KnowledgePanel); entity_aliases живая; locations живая.

## Дефекты
- [ВЫС] DELETE /style-profiles/:id при привязке к книге → 500 FOREIGN KEY constraint failed — style.ts:200-207; 0005_style.sql `REFERENCES style_profiles(id)` без ON DELETE; schema.ts:26-29 обещает set null. Фикс: UPDATE books SET style_profile_id=NULL + DELETE одной транзакцией или 409 со списком книг.
- [СРЕД] Сироты при удалении героя/локации/предмета: entity_aliases, entity_chapter_mentions (без FK), book_facts.entity_id — entities.ts:205-227, :287-296, :357-366 (герой чистит только entity_profile_versions). uq_entity_aliases_alias блокирует повторное добавление алиаса. Вероятно.
- [СРЕД] schema.ts не описывает базу (см. таблицу).
- [НИЗ] @langchain/langgraph-checkpoint-sqlite (server/package.json:26) не используется.
- [НИЗ] Ручные/перенесённые события героя (source_version_id NULL) вне уникального индекса uq_character_events_dedup → повтор POST /characters/:id/knowledge даёт дубль. Вероятно.

## Не проверено (агентом)
.env; версия pnpm; вызываются ли LangGraph-графы сервером; book_facts.superseded_by в schema.ts; resolveEntity на висящем алиасе; внешние факты Jev.
