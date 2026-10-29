# QR POS Bridge — подключение тестовой кассы без создания заказов

**Статус:** тестовый код, PR #214 (сайт) и PR #4 (C# POS). Этот план намеренно начинает с HTTPS-диагностики, когда создание заказов, оплата и кухонная печать **невозможны**. Не объединять с main и не включать на рабочих кассах до сквозного испытания.

## 1. Отдельное тестовое окружение Cloudflare

1. Предпочтительно создать **отдельный Cloudflare Pages проект** для ветки `feature/qr-order-internal-core-20261029`, без привязки к рабочему домену `smarthoreca.pages.dev`. Публикуйте только тестовую ветку, не main. Заранее проверьте точный HTTPS-домен, который выдаст Pages; **не придумывайте URL**.
2. В Workers & Pages → тестовый проект → Settings → Bindings привяжите `DB` к **отдельной тестовой D1**. Никогда не используйте боевую `anarsystem-db` в этой конфигурации. Проверьте ID базы и binding `DB` до первого HTTP-запроса.
3. В Settings → Variables and Secrets создайте **зашифрованные Secrets**:
   - `PLUGIN_INGEST_TOKEN` — согласованный серверный токен, использующийся в проверке тестового plugin registry;
   - `QR_POS_BRIDGE_TOKEN` — новый независимый сильный случайный секрет;
   - `QR_ORDER_RATE_SECRET` — независимый секрет защиты публичных QR-заявок.
   - `SH_BACKEND_API_URL` — проверенный адрес API backend, который умеет отдавать `/api/plugin/data`. Он отличается от Socket.IO namespace; не следует механически подставлять `/plugin-websocket`.
   - `SH_BACKEND_PROXY_TOKEN` — лишь если данный тестовый backend требует доверенный межсерверный токен; никогда не отправлять его в браузер или плагин.
4. Не копируйте секреты в GitHub, браузерный JS или чат. Публичные preview URL по умолчанию доступны в интернете; диагностический обмен защищается двумя секретами и проверкой registry. Для реальных гостевых заказов потребуется отдельное ограничение доступа/антибот-защита.
5. Страница администрирования QR требует тестового workspace/подключения и опубликованного QR-меню в **этой** тестовой D1. Пустая D1 сама не содержит пользователей, меню и опубликованных блюд. Создавайте тестовое рабочее пространство и меню, не импортируя рабочие заказы или реальные данные гостей.

Cloudflare Pages допускает отдельные preview и production D1 bindings и секреты; не предполагайте, что у существующего проекта preview уже изолирован. Документация Cloudflare: https://developers.cloudflare.com/pages/functions/bindings/ ; https://developers.cloudflare.com/pages/configuration/preview-deployments/

## 2. Касса: безопасный диагностический режим

Используйте тестовый пакет C# из ветки `feature/qr-pos-bridge-v1-20261029` **после успешной CI-сборки**. Сохраните прежние настройки и каталог плагина вне `Plugins`. В защищённый локальный `smarthoreca.json` с правильным `PluginId` добавьте:

```json
{
  "PluginId": "TEST_REGISTERED_PLUGIN_GUID",
  "SocketAuthSecret": "EXISTING_LOCAL_HMAC_KEY_IF_CONFIGURED",
  "QrPosBridge": {
    "Enabled": true,
    "AllowOrderCreation": false,
    "AllowKitchenPrint": false,
    "Url": "https://ACTUAL-TEST-PAGES-HOST/api/qr-menu/pos-bridge",
    "PluginIngressToken": "MATCH_SERVER_PLUGIN_INGEST_TOKEN",
    "BridgeToken": "MATCH_SERVER_QR_POS_BRIDGE_TOKEN",
    "PollSeconds": 10
  }
}
```

Это **шаблон, не рабочие значения**. `OperatorPin` в диагностическом режиме не нужен. Не заменяйте существующий `PluginId` и HMAC ключ случайными значениями и не публикуйте исходный файл.

Важно: существующее Socket.IO соединение `http://68.233.120.197/plugin-websocket` остаётся **без изменений**. QR API — независимое HTTPS-соединение.

При запуске ожидается в логе:
- `Initialized as V8Preview5 plugin`;
- `SocketIOFactory ... auth=hmac-sha256-v1`, если прежний локальный HMAC ключ настроен;
- `SocketConnectionManager :: Client connected`;
- `QrPosBridge :: diagnostics only (no polling, POS orders or kitchen printing).`;
- `QrPosBridge :: HTTPS diagnostic handshake accepted; no POS writes or kitchen printing.`.

Если `QrPosBridge :: connection paused: QR Bridge HTTP 401`: проверьте два тестовых секрета локально.
Если HTTP 403: проверьте регистрацию `PluginId + DepartmentId` на тестовом backend.
Если HTTP 502: проверьте `SH_BACKEND_API_URL` и доступность backend plugin registry.
Если HTTP 503: проверьте Secrets и D1 binding.
Если не появляется сообщение об успешном hello, **не включайте приём QR-заказов**.

На сервере таблица `qr_pos_bridge_capabilities` должна показывать свежее `last_seen_at` и значения `can_create_order=0`, `can_ack_fiscal=0`, `can_print_kitchen=0`. Админ-интерфейс при корректном тестовом workspace покажет «Касса подключена… Режим диагностики».

## 3. Переход к первому безопасному заказу

Только после успешного диагностического hello, на **тестовом стенде**:

1. Проверьте реальные GUID test `DepartmentId`, `PluginId`, POS стола и одного простого блюда без размеров, модификаторов и составных продуктов.
2. Убедитесь, что опубликованное меню в **тестовой D1** использует точный GUID POS блюда и цену, равную кассовой. Прикрепите только тестовый стол к реальному POS GUID стола.
3. Создайте отдельного тестового оператора iikoFront с минимальными правами; его PIN храните только локально. Убедитесь, что тестовый кухонный принтер доступен, и что касса может штатно печатать на него.
4. Только затем установите `AllowOrderCreation=true`, `AllowKitchenPrint=true`, добавьте `OperatorPin`, перезапустите тестовый плагин. Сервер получит `can_create_order=1` и разрешит pull.
5. В `qr-order-admin.html` выберите тестовый `posPluginId` и включите `orderingEnabled=true` только после сообщения «Касса подключена: приём заказов и печать кухни разрешены».
6. Отправьте **один** заказ с QR тестового стола, проверьте ровно один POS Order, ровно один кухонный билет, затем отдельно оплату/фискальный результат. При любой неопределённости не повторяйте заказ автоматически.

## 4. Границы готовности

Успешный `hello` доказывает только HTTPS/секреты/реестр. Успешный CI — только компиляцию и протокольные проверки. Ни то ни другое не подтверждает фактическую печать или фискализацию. На production нужны реальные испытания, проверка версий, явная изоляция организаций, защита секретов **для каждой кассы**, ограничение доступа и сценарии восстановлений.
