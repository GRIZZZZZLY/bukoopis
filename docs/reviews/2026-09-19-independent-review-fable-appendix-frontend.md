# Зона H — фронтенд (отчёт субагента, сохранён вручную; Write у субагента был запрещён)

Контекст: автосейв `useDebouncedSave` delayMs 10000 (ChapterPage.tsx:185-189); `PUT /chapters/:id/draft` тело `{contentJson}` БЕЗ ревизии (api/client.ts:232-241); ответ (revision, updatedAt, wordCount) кладётся в chapter.draft (ChapterPage.tsx:148-163). Название главы автосейвом не сохраняется — только onSave (:482-484).

## Таблица потери несохранённого текста
| Событие | Код | Теряется | Увер. |
|---|---|---|---|
| Закрытие вкладки при dirty | beforeunload+preventDefault (ChapterPage.tsx:414-423); sendBeacon/flush нет | ≤10 с + всё после неудачного автосейва | подтв. |
| Переход внутри приложения → «Сохранить и уйти» | useBlocker (:426-429) → handleBlockedSave (:577-580): `await onSave(); blocker.proceed()`; onSave глотает ошибку (:487-493) | ДА при сбое createVersion | подтв. |
| Ctrl+S упал | setError → `if (error) return <карточка>` (:613-630), редактор размонтирован | ДА: рукопись невидима, выход — перезагрузка | подтв. |
| Автосейв упал | catch: toast, saveError, rethrow (:175-180); flush не перезапускает таймер (useDebouncedSave.ts:29-43) | нет пока вкладка открыта; повтор только по клавише | подтв. |
| Печать во время Writer | onUpdate: `if (isPreviewRef.current \|\| writingRef.current) return;` (:259) | ничего не сохраняется всё время генерации | подтв. |
| Принятие кандидата | onAccepted → load() (:828-835) → setContent (:297); сервер удаляет chapter_drafts (prose-proposals.ts:404) | ДА без предупреждения | подтв. |
| PlanPanel «Сгенерировать/Выбрать» | PlanPanel.tsx:59,73 → onUpdated=load (:786) → setContent | ДА (<10 с набора) | подтв. |
| Self-repair принят | CritiquePanel.tsx:376-382 → onRepairDone=load (:938) | как выше | подтв. |
| Предпросмотр версии → Esc / «(current)» | Esc только setPreviewVersionId(null) (:602-608); «(current)» ставит currentVersion, не черновик (:439-447); setContent(…, false) → dirty не пересчитан | ДА отложенно: следующая клавиша автосохраняет текст версии поверх черновика | подтв. |
| Ctrl+S из предпросмотра / «Восстановить» | createVersion/restore удаляют chapter_drafts (chapters.ts:301, :332); предупреждения нет (:453-494, :563-575) | ДА | подтв. |
| Смена названия + автосейв текста | setDirty сравнивает titleBaselineRef с самим собой (:169-174) → всегда false | ДА (название) | подтв. |
| Переключение главы через OutlineRail | key={chapterId} remount (App.tsx:66-69); cleanup без flush, но blocker при dirty | нет | подтв. |
| Обрыв SSE Writer без done/error | streamWriteChapter тихо выходит (client.ts:1315-1337); writing навечно, writingRef блокирует автосейв | косвенно ДА | подтв. |
| Мастерская: seedByAspect, editText (AspectRunner), имена каста (EntityStageRunner), idea в IdeaIntake | локальный state, ни blocker, ни beforeunload | ДА при уходе/F5 | подтв. |

## SSE-клиенты
Все — fetch+getReader (не EventSource); реконнекта и клиентского таймаута молчания нет; сервер write/repair ping не шлёт.
| Поток | Клиент | Отмена | Обрыв без терминального события | Подхват после F5 |
|---|---|---|---|---|
| Writer write (plot.ts:391-517) | client.ts:1284-1345 | AbortSignal+cancelProposal (ChapterPage.tsx:496-502) | НЕ обработан — writing навечно | частично: useRestoredProposal берёт лишь ready/incomplete (useRestoredProposal.ts:26-28); streaming не виден |
| Repair (critique.ts:379-517) | client.ts:1223-1269 | только серверная cancelProposal | НЕ обработан | нет |
| Inline | client.ts:1002-1045 | нет | НЕ обработан — active.streaming навечно | нет |
| Aspect generate/refine/playbook | client.ts:1079-1129 | нет | да — sawTerminal → onError (:1126-1128) | нет |
| Intake | client.ts:815-866 | cancelIntake по requestKey | да (throw) | да — inflight+опрос 2 с (IntakePanel.tsx:57-127) |
| Quick start | client.ts:934-978 | cancelQuickStart | не обработан (finally сбрасывает running) | да (QuickStartPanel.tsx:78-127) |

## Дефекты
- [КРИТ] Сбой Ctrl+S прячет рукопись за карточкой ошибки — ChapterPage.tsx:487-493, :613-630. Тот же error для load (:305-307) и onRestore (:571). Фикс: ошибки операций — баннер над редактором; карточка только при !chapter.
- [КРИТ] «Сохранить и уйти» уходит при упавшем сохранении — ChapterPage.tsx:577-580 (`await onSave(); blocker.proceed?.()`), onSave глотает ошибку. Фикс: onSave→boolean.
- [КРИТ] Обрыв SSE без терминального события замораживает Writer/repair/inline и отключает автосейв — client.ts:1314-1337 (также :1244-1268, :1023-1044, :951-977); ChapterPage.tsx:259. Образец правильной обработки: client.ts:1126 sawTerminal. Фикс: общий SSE-парсер с sawTerminal; автосейв по writing не глушить.
- [ВЫС] Принятие кандидата стирает набранное — ChapterPage.tsx:259, :148-163, :828-835; prose-proposals.ts:404; ProposalPanel.tsx:205-207 «Глава не изменена…». Фикс: при dirty/черновике новее версии — явный выбор.
- [ВЫС] load() из PlanPanel и self-repair затирает редактор — ChapterPage.tsx:786, :938, :296-303; PlanPanel.tsx:59, :73. Фикс: перечитывать главу без setContent.
- [ВЫС] Выход из предпросмотра оставляет текст версии; следующий автосейв затирает черновик — ChapterPage.tsx:439-451, :602-608.
- [ВЫС] Ctrl+S из предпросмотра и «Восстановить» удаляют черновик без подтверждения — ChapterPage.tsx:453-494, :563-575; chapters.ts:300-301, :330-332.
- [ВЫС] Автосейв не повторяется после ошибки — useDebouncedSave.ts:29-43; ChapterPage.tsx:175-180; `void flush()` при rethrow — unhandled rejection; flushNow есть, никем не вызывается.
- [ВЫС] Inline вставляет результат по устаревшим позициям — InlineCommandPanel.tsx:87-89, :157-164 insertContentAt({from,to}) без mapping.
- [ВЫС] Принятие другого раздела во время генерации → 409 → потеря сгенерированного — AspectRunner.tsx:130-164 (:154 `await onPatch(revision, next)` с ревизией из замыкания); MarkdownStagePage.tsx:85-99; EntityStageRunner.tsx:227-264.
- [ВЫС] Неудачное сохранение правки раздела стирает текст автора — AspectRunner.tsx:298-344 (:341-343 applyPatch не пробрасывает; затем setEditText("")).
- [СРЕД] Название главы теряется после автосейва — ChapterPage.tsx:169-174.
- [СРЕД] Статус «Сохранено HH:MM» при несохранённых правках — ChapterPage.tsx:1200-1236 (dirty проверяется после lastSavedAt).
- [СРЕД] ProposalPanel хранит состояние прежнего кандидата (selected, requestIdRef `accept-<A.id>-…`) при смене proposal — ProposalPanel.tsx:71-82; ChapterPage.tsx:504-561, :817-842. Фикс: key={proposal.id}.
- [СРЕД] Зависший inline-стрим нельзя отклонить/повторить — InlineCommandPanel.tsx:192-200, :257-269 disabled={active.streaming}.
- [СРЕД] Гонка ответов в CritiquePanel при смене версии — CritiquePanel.tsx:92-111 без флага отмены.
- [СРЕД] Незавершённый Writer не виден после F5 — useRestoredProposal.ts:26-28 (streaming не показывается; повтор = второй платный прогон).
- [СРЕД] Ошибка операции заменяет страницу карточкой без выхода — BooksListPage.tsx:84-107; ChaptersStagePage.tsx:78-89, :109-126, :248; SettingsStagePage.tsx:103-104, :142-158; StyleProfilesPage.tsx:293-294, :324-340.
- [СРЕД] Удаление одним кликом без подтверждения и без обработки ошибки — KnowledgePanel.tsx:239, :296, :368, :457 (локации/предметы/крючки/отношения); StyleProfilesPage.tsx:558-568; MemoryStatus.tsx:235-251 MemoryStaleBanner запускает платное перестроение одним кликом (у MemoryPipelineBanner двухшаговое :141-183).
- [СРЕД] После обрыва SSE интейка/быстрого сбора панель забывает прогон; сервер второй не отвергает — IntakePanel.tsx:213-219, :57-127; QuickStartPanel.tsx:156-162; studio.ts:635-640.
- [СРЕД] Тексты автора в Мастерской без защиты от ухода — AspectRunner.tsx:55-57, :519-531; EntityStageRunner.tsx:176-178, :333-354; ConceptStage.tsx:23.
- [СРЕД] Ответы API/SSE кастами без схемы; одна граница ошибок — client.ts:169-184 (`res.json() as T`), :1329-1332; PlanPanel.tsx:21; PlanStagePage.tsx:19; main.tsx:10-17. Кандидат на краш: KnowledgePanel.tsx:453 `r.tension.toFixed(2)` при null (вероятно).

## Проверено и держится
Remount по key (App.tsx:66-69, App.remount.test.tsx:54-78); TipTap 2.27.2 свежие колбэки; двойной запуск Writer заблокирован (ChapterPage.tsx:680, :506, :598); CritiquePanel error/partial (:244-274), «Ответили X из Y» (:416-421), baseChanged (:276-290); 409 при принятии → перечитывание без setContent (ProposalPanel.tsx:42-60, :145-175; ChapterPage.tsx:322-336); requestId идемпотентен (ProposalPanel.tsx:80-82); кандидат ready/incomplete восстанавливается после F5; интейк adopt/опрос/стоп (IntakePanel.tsx:57-127, :222-236), файлы по одному (:146-159); StudioPage reload с guard requestIdRef (:115-156); ConceptStage sync idea (:35-48); подтверждения: удаление книги (SettingsStagePage.tsx:382-397), профиля стиля (StyleProfilesPage.tsx:315), персонажа (KnowledgePanel.tsx:131), перестроение по конвейеру (MemoryStatus.tsx:141-183); reorder оптимистичен с откатом (ChaptersStagePage.tsx:274-309), частичный успех не обрабатывается; postAspectStream терминальная защита (client.ts:1126-1128); опрос памяти пока updating (ChapterPage.tsx:212-216).

## Не проверено (агентом)
studio.ts целиком; prose-proposals.ts вне :280-429; saveChapterDraftInputSchema; MarkdownStagePage вне handlePatch, EntityStagePage, PlaybookRunner, ManualAspectForm, OutlineRail, CanonPanel, AppShell/StatusBar, DropZone, IntakeProgress, VoiceSamples, RelationshipQualities, computeRecommendedNextStage; nullable ли Relationship.tension; браузер не запускался.

## Наблюдения для продукта
- Прозрачность: автор не видит, что модель знала; манифест только на сервере; единственный сигнал — баннер baseChanged в критике (CritiquePanel.tsx:276-290). Экрана «что видела модель» нет.
- Стоимость: до запуска — эвристика WriterCostBadge (ChapterPage.tsx:1253-1298 «4k слов ≈ 4500/11000 токенов»); фактические tokens приходят в done Writer/repair/inline (client.ts:1275-1279, :1215-1219, :987-990) и ВЫБРАСЫВАЮТСЯ (ChapterPage.tsx:520-533, CritiquePanel.tsx:179-192, InlineCommandPanel.tsx:127-128). Стоимость критики/плана/аспектов/интейка на экранах не показывается; есть /usage. Настройки: «прогноз за главу» (SettingsStagePage.tsx:256-258), Anthropic подписан как «Подписка» (:313-315).
- Путь до первой главы: «Новая книга» (BooksListPage.tsx:134) → задумка+«Начать» (:159) → Studio → «Сгенерировать питчи» (ConceptStage.tsx:184-192) → выбор питча = lock (:108-112) → «План» (StudioPage.tsx:301-323) → «Сгенерировать варианты» (PlanStagePage.tsx:178) → «Выбрать этот вариант» (:300) → «Утвердить план» (:204) → «Главы» (StudioPage.tsx:230) → глава (ChaptersStagePage.tsx:395) → «Сгенерировать план» (PlanPanel.tsx:111) → «Выбрать» (:197) → «Запустить Writer» (ChapterPage.tsx:678) → «Принять целиком» (ProposalPanel.tsx:298). ≈14 кликов, 4 ожидания LLM при пропуске мира/лора/персонажей.
