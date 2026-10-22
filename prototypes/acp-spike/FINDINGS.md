# ACP spike: результаты (PROTOTYPE)

Одноразовый прототип. Вопрос: может ли локальное Node-приложение управлять установленными агентами пользователя через ACP с теми рычагами, которые предполагают ADR-0001 и ADR-0002. Дата прогона: 2026-10-22, macOS, Node 24.19.0, pnpm 12.14.0.

Запуск: `pnpm --dir prototypes/acp-spike spike <claude|codex|opencode> [probe|new|resume]`.
`probe` делает только `initialize` и `session/new` (без хода модели), `new` выполняет три хода (персона, скрытое состояние с MCP, проверка инструментов), `resume` перезапускает процесс агента, загружает сессию и спрашивает факт из прошлого. Варианты включаются переменными `SPIKE_*` (см. `spike.ts`). Логи пишутся в `runs/`, они в `.gitignore`, потому что содержат локальные пути и конфигурацию владельца.

## Версии

| Компонент | Версия |
|---|---|
| `@agentclientprotocol/sdk` | 2.0.1 (entrypoint `/unstable`, ACP v1) |
| `@agentclientprotocol/claude-agent-acp` | 0.94.0 (внутри `@anthropic-ai/claude-agent-sdk` 0.3.303 с собственным бинарником Claude Code 2.1.303) |
| `@agentclientprotocol/codex-acp` | 2.2.2 (внутри `@openai/codex` 0.160.1) |
| `opencode acp` | 1.18.30 (установленный `/opt/homebrew/bin/opencode`) |
| `@modelcontextprotocol/sdk` | 1.32.1 (stateless Streamable HTTP) |
| `zod` | 4.6.7 |
| Установленные CLI для сравнения | `claude` 2.1.306, `codex` 0.163.0 |

Модели в прогонах: Claude `haiku` (claude-haiku-5-5), Codex `gpt-5.6-luna`, OpenCode `deepseek/deepseek-flash`. Бесплатные модели OpenCode Zen не сработали (см. подводные камни).

## Таблица

| # | Проверка | Claude (`claude-agent-acp`) | Codex (`codex-acp`) | OpenCode (`opencode acp`) |
|---|---|---|---|---|
| 1 | Старт по подписке, без API-ключа | PASS | PASS | PASS* |
| 2 | Наш HTTP MCP через `session/new`, вызов `record_attempt` | PASS | PASS | PASS |
| 3 | Персона "Interviewer" | PASS (override) | PASS (append + замена на уровне процесса) | PASS (замена через custom agent) |
| 4 | Allowlist инструментов | PASS (с `strictMcpConfig`) | PARTIAL | PASS |
| 5 | Скрытый контекст `<session_state>` | PASS, возвращается при load | PASS, возвращается при load | PASS, возвращается при load |
| 6 | Resume после перезапуска процесса | PASS | PASS | PASS |
| 7 | Данные об использовании контекста | PASS | PASS | PASS |
| 8 | Потоковые события | PASS | PASS | PASS |

\* OpenCode не имеет подписки в том же смысле: он работает на провайдерах, настроенных у владельца. Ключи хранит сам OpenCode (`~/.local/share/opencode/auth.json`), приложению они не нужны.

## Доказательства по пунктам

1. **Авторизация.** Дочерний процесс запускается без `ANTHROPIC_*`, `OPENAI_*`, `CODEX_API_KEY` и без переменных `CLAUDE*` родительской сессии (лог `spawn`: `apiKeyVarsInChildEnv` содержит только посторонний `GRAFANA_API_KEY_PROD`). Claude: `authMethods: []`, ход прошёл, в `usage_update._meta._claude/rateLimit` пришли окна подписки `five_hour` и `seven_day`. Codex: `authMethods: ["api-key","chat-gpt"]`, `authenticate` не понадобился, использовался ChatGPT-логин из `~/.codex/auth.json`. OpenCode: `authMethods: ["opencode-login"]`, использовался ключ DeepSeek из конфигурации OpenCode.
2. **MCP.** Во всех трёх агентах сервер подключился на `session/new` (`initialize`, `tools/list` в логе MCP), и модель вызвала `record_attempt({question_id:"q-pg-index-07", score:2, evidence_quote:"an index speeds up reads at the cost of slower writes"})`. Имена инструмента: Claude `mcp__interview__record_attempt`, Codex `mcp.interview.record_attempt`, OpenCode `interview_record_attempt`.
3. **Персона.** Ответ на "Who are you?" во всех трёх начинается с "I'm Interviewer". Механизмы:
   - Claude: поле `systemPrompt: {mode:"override", content:[text]}` в `session/new`. Адаптер объявляет `sessionCapabilities.systemPrompt.mode.override`. Запасной путь: `_meta.systemPrompt` (строка заменяет промпт, объект дописывает к пресету).
   - Codex: на сессию только дописывание через `_meta.jetbrains.air.customInstructions`, которое адаптер передаёт как `developerInstructions`. Замена базового промпта возможна только на уровне процесса через `CODEX_CONFIG={"model_instructions_file": ...}`. Оба способа были включены одновременно, вклад каждого отдельно не проверялся.
   - OpenCode: `OPENCODE_CONFIG_CONTENT` с `agent.interviewer` (`mode: "primary"`, `prompt`, `permission`) и `default_agent: "interviewer"`. В `configOptions` сессия сразу пришла с `mode = interviewer`. Первый ход занял около 950 входных токенов, значит системный промпт действительно заменён.
4. **Allowlist.** Каждого агента попросили показать файлы, выполнить `echo spike` и перечислить свои инструменты.
   - Claude, базовый вариант (`_meta.claudeCode.options.tools: ["WebFetch","WebSearch"]`, `settingSources: []`): встроенные инструменты отключены, но в сессию попали коннекторы аккаунта claude.ai (`mcp__claude_ai_Claude_Docs__*`). Вариант `strict` (`strictMcpConfig: true` и `env.ENABLE_CLAUDEAI_MCP_SERVERS=false`) оставил ровно `WebFetch, WebSearch, mcp__interview__record_attempt` (плюс `Bash`, добавленный для теста). Оба флага ставились вместе, какой из них решающий, не выяснялось.
   - Codex: `features.shell_tool=false` и `unified_exec=false` убирают shell. Без дополнительных мер остаются десятки инструментов из `~/.codex` (`codex_apps` с коннекторами ChatGPT, `node_repl`, `cua_repl`, `multi_agent`, `image_gen`, `apply_patch`, goals). Вариант `lockdown` (отключение `apps`, `plugins`, `goals`, `image_generation`, `browser_use`, `computer_use` и других) сократил список до `apply_patch, mcp__node_repl__js*, multi_agent_v1__*, list/read_mcp_resource*, web__run, mcp__interview__record_attempt`. Пользовательский MCP `node_repl` через `mcp_servers.node_repl.enabled=false` в конфиге сессии не отключается, `include_apply_patch_tool` Codex игнорирует. Изолированный `CODEX_HOME` убирает всё унаследованное, но требует отдельного логина (`Authentication required`). Песочница при этом `readOnly` и `approvalPolicy: on-request`.
   - OpenCode: `permission: {"*":"deny", webfetch:"allow", websearch:"allow", "interview_*":"allow"}` плюс `tools: {...:false}`. Агент видит только `interview_record_attempt, webfetch`. `websearch` не появился, видимо ему нужен отдельный флаг Exa.
   - Ни один агент не попытался вызвать запрещённый инструмент, поэтому ветка отказа в обработчике `session/request_permission` не сработала ни разу. Claude отказался выполнить `Bash` даже при явном "admin override", поскольку персона запрещает shell. В Claude запрос разрешения на наш MCP пришёл только в режиме `default` без `allowedTools` и был одобрен (`allow-once`). С `allowedTools` вызов одобряется без запроса (SDK пишет предупреждение `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`). В Codex вызов MCP одобрил встроенный "Guardian Review" (`tool_call` kind `think`), до клиента запрос не дошёл.
5. **Скрытый контекст.** Блок `{type:"resource", resource:{uri:"app://session-state", mimeType:"application/json", text:"<session_state>{...question_number:4...}</session_state>"}}` все три агента использовали правильно: "This is question 4" и `question_id` из состояния. При `session/load` блок возвращается как обычный текст `user_message_chunk`, а не как `resource`, и формат у каждого свой:
   - Claude: два чанка, `"app://session-state"` и `"\n<context ref=\"app://session-state\">\n<session_state>…</session_state>\n</context>"`;
   - Codex: один чанк `"app://session-state\n<context ref=\"app://session-state\">…</context>"`;
   - OpenCode: `"[app://session-state]\n<session_state>…</session_state>"`.
6. **Resume.** Процесс агента полностью завершался, затем новый процесс выполнял `initialize` и `session/load` (все трое объявляют `loadSession: true`, а также `sessionCapabilities.resume`) с тем же `sessionId`, `cwd` и `mcpServers`. На "what is my favorite database?" все ответили "CockroachDB". История воспроизводится через `user_message_chunk`, `agent_message_chunk`, `tool_call` и `tool_call_update`.
7. **Использование.** Все три присылают `usage_update {used, size}`, Claude и OpenCode добавляют `cost`. Окно: Claude 1 000 000 (haiku), Codex 258 400, OpenCode 1 000 000. Ответ `session/prompt` содержит `usage` (`inputTokens`, `outputTokens`, `cachedReadTokens` и т. д.), у Claude и Codex есть ещё `_meta.quota.model_usage`. У Claude в `_meta._claude/rateLimit` приходит загрузка окон подписки. Для ротации сессий достаточно `used / size`.
8. **События** (`sessionUpdate`):
   - Claude: `agent_message_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `available_commands_update`, `session_info_update` (заголовок сессии), при load ещё `user_message_chunk`;
   - Codex: `agent_message_chunk` (очень мелкие чанки, около 5900 за длинный ответ), `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `session_info_update`, `available_commands_update`;
   - OpenCode: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `available_commands_update`.

## Подводные камни

- **Утечка пользовательской среды агента.** Сессии наследуют глобальную конфигурацию владельца:
  - Claude: коннекторы claude.ai (лечится `strictMcpConfig` и `ENABLE_CLAUDEAI_MCP_SERVERS=false`), слэш-команды и скиллы пользователя в `available_commands_update`, `defaultMode: auto` из настроек пользователя (режим надо явно ставить через `session/set_config_option`);
  - Codex: `~/.codex/AGENTS.md` попадает в `instructionSources`, поэтому Codex отвечал по-русски вопреки персоне; кроме того наследуются hooks, skills, плагины и MCP-серверы;
  - OpenCode: модель по умолчанию берётся из глобального конфига, а не из `agent.model`, поэтому модель надо ставить через `session/set_config_option`.
- **Codex не даёт точного allowlist.** Кроме shell, через конфиг сессии не отключаются `node_repl` (выполнение JS), `apply_patch` и `multi_agent_v1`. Надёжное решение: отдельный `CODEX_HOME` приложения с собственным логином владельца. Его надо проверить отдельно, потому что копировать или симлинковать `auth.json` опасно из-за ротации refresh-токена.
- **Режим Codex не совпадает с фактическим.** ACP сообщает режим `agent`, а поток на самом деле `readOnly` + `on-request` из `CODEX_CONFIG`. Выбор модели после `session/load` не сохраняется: возвращается дефолтная `gpt-6.1-sol`, поэтому модель надо выставлять заново после каждой загрузки.
- **Codex Guardian.** Встроенный auto-reviewer одобряет вызовы инструментов сам, и `session/request_permission` до клиента не доходит. Контроль доступа нельзя строить на разрешениях, нужна валидация на стороне MCP, как и записано в ADR-0002.
- **Бесплатный тир OpenCode Zen недоступен через ACP.** Обе попытки (`nemotron-3-ultra-free`, `mimo-v2.6-flash-free`) вернули "OpenCode's free tier can only be used from within OpenCode". Обходить это подменой `clientInfo` я не стал. Кроме того, ключ OpenCode Zen у владельца истёк (`opencode run` пишет "This API key has expired"). Прогон выполнен на `deepseek/deepseek-flash` (модель владельца по умолчанию), всего около $0.0005.
- **Лимиты Codex.** Владелец предупредил, что лимиты исчерпаны, но на `gpt-5.6-luna` ходы прошли. Один ход resume случайно ушёл на `gpt-6.1-sol`, потому что модель после load сбросилась. Бесплатных моделей у Codex нет.
- Адаптеры Claude и Codex используют собственные встроенные бинарники (Claude Code 2.1.303, Codex 0.160.1), а не установленные CLI. Подменить можно через `CLAUDE_CODE_EXECUTABLE` и `CODEX_PATH`. При этом логин общий: keychain для Claude, `~/.codex/auth.json` для Codex.
- Имена MCP-инструментов различаются (`mcp__x__y`, `mcp.x.y`, `x_y`). Сопоставлять вызовы надо по `rawInput` и `_meta`, а не по заголовку.
- `rawInput` в первом `tool_call` бывает пустым (Claude, OpenCode). Аргументы приходят в следующем `tool_call_update`.

## Рекомендация для agent-driver

1. ACP как основной транспорт подтверждён для всех трёх агентов: старт, MCP, персона, скрытый контекст, load, usage и стриминг работают. Резервный прямой драйвер из ADR-0001 сейчас не нужен.
2. Интерфейс драйвера должен принимать на сессию: `persona`, `allowedBuiltins` (`web_fetch`, `web_search`), `mcpServers`, `model`, `mode`. Каждый адаптер переводит их по-своему:
   - Claude: `systemPrompt.override`, `_meta.claudeCode.options.{tools, settingSources:[], strictMcpConfig:true, env.ENABLE_CLAUDEAI_MCP_SERVERS:"false"}`, явный `mode=default`;
   - Codex: `customInstructions` плюс `CODEX_CONFIG` процесса (`model_instructions_file`, `features.*`, read-only), отдельный процесс на каждый набор инструкций;
   - OpenCode: процесс на каждую персону, `OPENCODE_CONFIG_CONTENT` с custom agent и `permission`, модель через `set_config_option`.
3. После `session/new` и после каждого `session/load` драйвер заново выставляет `model` и `mode`.
4. Фильтр скрытого состояния в UI должен работать по маркеру `app://session-state` в текстовых `user_message_chunk` и вырезать `<context ref="app://…">…</context>`, `[app://…]` и `<session_state>…</session_state>`. Блок лучше всегда отправлять первым в ходе.
5. Ротацию сессий строить на `usage_update.used / size`.
6. Для Codex стоит предусмотреть изолированный `CODEX_HOME` приложения с отдельным логином (одноразовый шаг онбординга). Без него allowlist и персона в Codex остаются частичными. В ADR-0002 стоит отметить, что у Codex наследуются глобальный `AGENTS.md` и MCP-серверы пользователя.
7. Целостность данных обеспечивает валидация на стороне MCP. На запросы разрешений полагаться нельзя: Codex Guardian и `allowedTools` в Claude их обходят.
