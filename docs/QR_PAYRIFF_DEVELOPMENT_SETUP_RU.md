# Настройка Payriff Development для Smart Horeca QR Pay (30.10.2026)

Это **подготовка тестового подключения**, а не запуск платежей и не разрешение создавать заказы на кассе.

## Безопасность

- Merchant ID и Secret Key в чат, код, GitHub, фронтенд, .json на кассе и скриншоты не отправлять.
- Задавать значения только в Cloudflare Pages → проект Smart Horeca → Settings → Variables and Secrets → **Preview**.
- Payriff Application должен иметь статус **Development**. Для Online/Production ключей данный тестовый режим не включать.
- Не изменять существующие `QR_POS_BRIDGE_TOKEN`, `PLUGIN_INGEST_TOKEN`, `SocketAuthSecret`.
- Не добавлять банковские реквизиты и PAN/CVV в D1 и логи. Карты вводятся на hosted checkout Payriff.
- После обновления переменных повторно развернуть Preview, не Production.

## Переменные Cloudflare Preview

| Name | Type | Value |
| --- | --- | --- |
| `PAYRIFF_TEST_MODE` | Text | `development` |
| `PAYRIFF_TEST_MERCHANT_ID` | Secret | ID из Payriff Applications |
| `PAYRIFF_TEST_SECRET_KEY` | Secret | Secret Key той же Application |
| `PAYRIFF_TEST_RESTAURANT_ID` | Text | точный ID тестового подразделения Smart Horeca из QR-заказов → диагностика |
| `PAYRIFF_TEST_HOST` | Text | `feature-qr-order-internal-co.smarthoreca.pages.dev` |

Не устанавливать секреты в Production. Запрещён wildcard-хост и чужое подразделение. Чтобы пользоваться другим URL/рестораном, установить отдельные значения.

## Как проверить, что настройки видны

1. Сохранить все 5 переменных, повторно развернуть Preview и обновить страницу Ctrl+F5.
2. Открыть QR Menu → QR-заказы и столы → раздел «Подключение кассы и диагностика».
3. Найти строку «Payriff Development». После успешной настройки она сообщает «ключи доступны серверу».
4. Сервер использует только наличие секретов и точное совпадение Development, host и restaurantId: **не проверяет действительность самих ключей запросом к провайдеру**. Успешную авторизацию Payriff нужно проверять отдельно через безопасный API-вызов, не списывая деньги.

## Что уже подготовлено в коде

- `/api/qr-menu/payriff-test-status` — закрытый администраторский endpoint готовности.
- `_lib/payriff-test.js` — строго ограниченный Preview/restaurant scope, GET заказа Payriff с серверной авторизацией, консервативная проверка APPROVED/PURCHASE/AZN/суммы/связи с заранее сохранённым intent.
- Никакой оплаты ещё не создаётся; `PAY_AT_POS` не включается; `guest-orders POST` и `POS Bridge pull` по-прежнему заблокированы.

## Следующий этап (отдельно, после настройки)

Сделать защищённый `payment intent`, создать Payriff hosted checkout в режиме Development, сохранить providerOrderId в D1 и связать с рестораном, столом, фиксированной корзиной, валютой, суммой, expiry и клиентским idempotency key. Затем callback + независимый server-side `GET /api/v3/orders/{orderId}` и тесты отказа, отмены, PRE_AUTH, replay, wrong amount, network errors. Только **после** этого реализовать выдачу оплаченного заказа POS и однократную кухонную печать, а также фискальную интеграцию и возвраты. Ни ответ клиента, ни HTTP 200 callback сами по себе не авторизуют выполнение.

Документация Payriff: https://docs.payriff.com/docs/developer-portal
