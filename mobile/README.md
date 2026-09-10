# AnarSystem Mobile

Flutter client for AnarSystem restaurant analytics. The mobile application lives in `mobile/` and does not replace or modify the existing web application.

## Current integration

- Flutter client for Android and iOS.
- Dashboard uses live data from the existing Cloudflare API: `https://anarsystem.pages.dev/api/iiko/sales`.
- iiko Server connection fields: IP, port, login and password.
- Connection credentials are stored locally with `flutter_secure_storage`.
- Dashboard periods: Today, Week and Month.
- Live KPIs: revenue, orders and average check.
- Revenue chart is built from iiko OLAP daily rows.
- Pull-to-refresh and retry handling are included.
- Sales screen uses the live API.
- Orders screen uses `/api/iiko/orders` and requests order rows from iiko OLAP.
- Orders screen supports date selection, order number, amount, table, waiter and status when those OLAP fields are available.
- Cash shifts screen uses `/api/iiko/cash-shifts` with the existing iiko Server cash-shift logic.
- Cash shift details use `/api/iiko/cash-shift-detail` and show cashless operations, pay-ins, pay-outs and individual payment records when available.
- Finance / P&L remains a placeholder for the next integration stage.

## Architecture

```text
iiko Server
    ↓
AnarSystem Cloudflare API
    ├── /api/iiko/sales
    ├── /api/iiko/orders
    ├── /api/iiko/cash-shifts
    └── /api/iiko/cash-shift-detail
    ↓
mobile/lib/core/api/iiko_api.dart
    ↓
Dashboard / Sales / Orders / Cash Shifts UI
```

The mobile app does not connect directly to iiko from the device. It sends the saved iiko connection parameters to the existing AnarSystem API, preserving the current web-side integration.

## Run locally

From the repository root:

```bash
cd mobile
flutter create . --platforms=android,ios
flutter pub get
flutter analyze
flutter run
```

Run `flutter create .` only inside `mobile/`; never against the repository root.

## Next modules

1. Finance / P&L — the agreed accounting logic based on account types.
2. OLAP constructor — fields, dimensions, measures and filters.
3. Multi-restaurant / user access and licensing.
