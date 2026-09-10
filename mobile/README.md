# AnarSystem Mobile

Mobile application foundation for AnarSystem. The app is intentionally kept in `mobile/` so the existing Cloudflare Pages web application is not changed.

## Direction

- Flutter client for Android and iOS.
- Existing AnarSystem web/API remains the source of business logic and data.
- UI follows the approved light blue/white AnarSystem design system.
- Navigation is modular so new web functionality can be added as new mobile modules without redesigning the shell.

## Current UI foundation

- Dashboard
- Sales
- Orders
- Finance / P&L
- More / modules
- OLAP, Analytics, Cash Shifts, Inventory, Employees, Reports and Settings module entries
- Future-module placeholder
- Reusable KPI cards, filters, headers and chart components

## Run locally

From the repository root, first generate the native Flutter platform folders if needed:

```bash
cd mobile
flutter create . --platforms=android,ios
flutter pub get
flutter run
```

Do not run `flutter create .` against the repository root. The existing web project stays untouched.

## Next integration step

Replace demo values with the existing AnarSystem API clients. Authentication, restaurant selection, iiko context and report data should be implemented behind service/repository classes rather than inside widgets.
