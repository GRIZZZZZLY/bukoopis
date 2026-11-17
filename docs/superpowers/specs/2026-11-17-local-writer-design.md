# Our fine-tuned model as the Writer (Ollama)

Approved by the author on 2026-11-17.

## Why

The author read the chapter 9–10 comparisons openly and preferred the prose of our fine-tuned model to Litrab's. It is YandexGPT-5-Lite-8B-pretrain with a QLoRA adapter (run3), trained on plan → scene pairs. Today it runs only from scripts in `D:\models`. The author wants it to write chapters inside book-forge. Critique, repair and phrase fixes stay on Claude and catch its logic slips (a character switching gender, a scene written past the stop point).

## What exists

- Books already have `writer_provider = 'ollama'` and `writer_local_model`, with a switch and a model tag field in the book settings. `streamTextOllama` (packages/llm/src/ollama.ts) calls `/api/chat` with Claude's instruction prompt (system + user).
- The model is registered in Ollama as `bookforge-writer:run3`:
  - Q4_K_M GGUF, built by merging the LoRA (`D:\models\work\merge_lora.py`), then `convert_hf_to_gguf.py`, then Ollama's `llama-quantize`;
  - Modelfile: `TEMPLATE {{ .Prompt }}`, num_ctx 8192, temperature 0.8, top_p 0.95, repeat_penalty 1.05, num_predict 1300;
  - Through `/api/generate` with `raw: true` it writes ~450–650 words in 12–17 s and stops by itself (`done_reason: "stop"`).
- The model was trained on scenes of ~600 words: mean 602, p10 569, p90 641. One call writes one scene.

## Approaches

1. **Raw training-format prompt via `/api/generate`** (chosen).
   - Build the exact prompt the model was trained on from book-forge's data.
   - Write the chapter scene by scene.
2. **Keep `/api/chat` with Claude's instructions.** Rejected: a pretrain model does not follow instructions. It was never trained on them.
3. **Python sidecar serving transformers + LoRA.** Rejected after the author approved downloading the GGUF converter. The sidecar would be an extra process to start, and it holds VRAM.

## Design

### Detection

A book whose provider is `ollama` uses the plan format when its Ollama model has a raw template.
- Check: `POST /api/show` returns `template` equal, after trim, to `{{ .Prompt }}`.
- Other Ollama models keep the existing chat path.
- No new setting. *(My call: a pretrain model with a raw template cannot follow chat anyway.)*
- The result is cached per tag for the server's lifetime.

### Prompt

The format is byte-for-byte what `gen_fresh.py` / `build_pairs.py` produce:

```
### План главы
Глава: <chapter title>
Манера: <measured manner line>
События:
1. <event>
2. <event>
Обязано произойти: <obligation>
Останавливается на: <stop event>

### Действующие лица
<Имя — роль или первое предложение описания>

### Конец предыдущей сцены
<tail>

### Текст главы
```

**Manner line.** It is measured from the previous chapter's full text by a TypeScript port of `manner_line`, and must give identical output to the Python version.
- Dialogue paragraph: one that starts with a dash. Said-tags: the `SAY` word list. First person: at least 1 pronoun per 100 narration words. Rounding is Python's round-half-even.
- With no previous chapter the line is omitted. *(My call.)*

**Cast.** Participants at the scene boundary (`assembled.participants`), one line each: `canonicalName — role`. When the role is empty, the first sentence of `description`. When both are empty, the name alone. Characters hidden from prompts are already excluded upstream.

**Tail.** The last 600 characters, cut to start after the first `". "` when cut. For the first scene this is the previous chapter's tail; for later scenes it is the text written so far. With nothing before, `—` (as in training).

### Chapter length: scene by scene

- Scene count K = ceil(target words / 600). Target words = `beatSheet.estimatedWords`, else 3000. *(My call; stage 2's thesis plan can set it later.)*
- Events:
  - With a beat sheet, the beats (`summary`) are split into K consecutive groups as evenly as possible. Fewer beats than K means one scene per beat.
  - Without beats, the chapter content (`chapters.intent`) is split into sentences, and the sentences into K groups.
  - Without content, each scene gets the single event «Продолжение главы».
- «Обязано произойти» and «Останавливается на» are the last event of the scene's group. The last scene uses the beat sheet's `closing.note` when present.
- Scenes are written one call each. They are joined with a blank line, stream to the client as they come, and progress is saved after each scene, like the existing beat mode. The SSE `beat` events carry `{index, total: K}`.
- The author's «по беатам»/«целиком» choice does not apply to this model: it is always scene by scene.

### Stop reason

- `/api/generate` reports `done_reason`. `stop` maps to `end_turn`, `length` maps to `max_tokens`.
- A chapter whose last scene hit the length limit is not marked complete.
- A chapter that stopped on its own still goes through the existing tail-based completion check.

### Scene intent

`prepareSceneIntent` (a paid Claude call) is skipped for this model: the prompt has no place for it. The SSE `scene_intent` event reports `prepared: false, degraded: false`.

### Unchanged

- Context assembly, manifests and source refs.
- Critics, Reviser, phrase fixes, proposals, CAS, cancel and heartbeat. Cancel aborts the in-flight Ollama request through the signal, and no later scene starts.

## Non-goals

- Training from the app.
- Automatic conversion of new runs. A new run is converted with the scripts in `D:\models\work` and registered under a new tag; the author types the tag.
- A model picker. The UI stays as is.

## Anti-goals

- Changing anything for books on Claude or on generic Ollama models.
- Using model output or Litrab texts as training data.
