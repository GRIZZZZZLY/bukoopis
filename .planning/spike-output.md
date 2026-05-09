
# Phase 0.2 SDK Capability Spike — Results

Model: `sonnet`

| Probe | OK | Duration ms | Turns | Tool calls | Result subtype | is_error | Error class | Error msg | Subtypes |
|---|---|---|---|---|---|---|---|---|---|
| native_output_format / happy | ❌ | 12347.3199 | 1 | — | success | false | SchemaMismatch | no structured_output on result | system:hook_started, system:hook_response, system:init, assistant, rate_limit_event, result:success |
| native_output_format / adversarial_invalid | ❌ | 148785.7959 | 1 | — | success | false | unexpected_no_output | No structured output and no error subtype (PROBLEM) | system:hook_started, system:hook_response, system:hook_progress, system:init, assistant, rate_limit_event, result:success |
| mcp_submit_tool / happy | ✅ | 42643.484400000016 | 2 | 1 | success | false | — | — | system:hook_started, system:hook_progress, system:hook_response, system:init, assistant, rate_limit_event, user, result:success |
| mcp_submit_tool / no_tool_observational | ✅ | 10381.022700000001 | 1 | 0 | success | false | observation | with prose-friendly system prompt, model invoked tool 0 times | system:hook_started, system:hook_response, system:init, assistant, rate_limit_event, result:success |
| mcp_submit_tool / double_call_observational | ✅ | 40512.4032 | 3 | 2 | success | false | observation | observed 2 tool calls when asked for two submissions | system:hook_started, system:hook_response, system:init, assistant, rate_limit_event, user, result:success |
| mcp_submit_tool / handler_isError | ✅ | 14143.189599999983 | 2 | 1 | success | false | observation | model invoked tool 1 times despite isError responses | system:hook_started, system:hook_response, system:init, assistant, rate_limit_event, user, result:success |

## Raw diagnostics per probe

### native_output_format / happy

```json
{
  "durationMs": 12347.3199,
  "turns": 1,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 25062,
    "cache_read_input_tokens": 0,
    "output_tokens": 35,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 25062,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.0945165,
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_response",
    "system:init",
    "assistant",
    "rate_limit_event",
    "result:success"
  ],
  "errorClass": "SchemaMismatch",
  "errorMessage": "no structured_output on result"
}
```

### native_output_format / adversarial_invalid

```json
{
  "durationMs": 148785.7959,
  "turns": 1,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 29884,
    "cache_read_input_tokens": 0,
    "output_tokens": 139,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 29884,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.114159,
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_response",
    "system:hook_progress",
    "system:init",
    "assistant",
    "rate_limit_event",
    "result:success"
  ],
  "errorClass": "unexpected_no_output",
  "errorMessage": "No structured output and no error subtype (PROBLEM)"
}
```

### mcp_submit_tool / happy

```json
{
  "durationMs": 42643.484400000016,
  "turns": 2,
  "toolCallCount": 1,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 30116,
    "cache_read_input_tokens": 30001,
    "output_tokens": 103,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 30116,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.1234923,
  "capturedPayload": {
    "city": "Paris",
    "population": 2100000,
    "isCapital": true
  },
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_progress",
    "system:hook_response",
    "system:init",
    "assistant",
    "rate_limit_event",
    "user",
    "result:success"
  ]
}
```

### mcp_submit_tool / no_tool_observational

```json
{
  "durationMs": 10381.022700000001,
  "turns": 1,
  "toolCallCount": 0,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 25177,
    "cache_read_input_tokens": 0,
    "output_tokens": 23,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 25177,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.09476775,
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_response",
    "system:init",
    "assistant",
    "rate_limit_event",
    "result:success"
  ],
  "errorClass": "observation",
  "errorMessage": "with prose-friendly system prompt, model invoked tool 0 times"
}
```

### mcp_submit_tool / double_call_observational

```json
{
  "durationMs": 40512.4032,
  "turns": 3,
  "toolCallCount": 2,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 30317,
    "cache_read_input_tokens": 30025,
    "output_tokens": 238,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 30317,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.12627824999999998,
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_response",
    "system:init",
    "assistant",
    "rate_limit_event",
    "user",
    "result:success"
  ],
  "errorClass": "observation",
  "errorMessage": "observed 2 tool calls when asked for two submissions"
}
```

### mcp_submit_tool / handler_isError

```json
{
  "durationMs": 14143.189599999983,
  "turns": 2,
  "toolCallCount": 1,
  "resultSubtype": "success",
  "isError": false,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 45433,
    "cache_read_input_tokens": 0,
    "output_tokens": 108,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 45433,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "totalCostUsd": 0.17200575,
  "messageSubtypes": [
    "system:hook_started",
    "system:hook_response",
    "system:init",
    "assistant",
    "rate_limit_event",
    "user",
    "result:success"
  ],
  "errorClass": "observation",
  "errorMessage": "model invoked tool 1 times despite isError responses"
}
```

