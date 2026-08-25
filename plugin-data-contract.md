# ANAR plugin data contract

This document is based only on the currently available `anar_posplagin` repository Swagger contract. It is a preparation layer; it does not claim fields that are not present in the source contract.

## Identity / connection

The available contract contains plugin fields such as:
- `pluginId`
- `pluginName`
- `serverUrl`
- `version`
- `currencyCode`
- `departmentId`
- `departmentName`
- `groupId`
- `groupName`
- `isConnectedNow`
- `activeSocketClients`
- `lastSavedJson`

The site will treat `departmentId` as the primary iiko matching key once the plugin's actual outgoing payload is confirmed.

## Dashboard data model

The source contract exposes these functional groups:

### Overview
- active employees
- open orders
- workload
- expected revenue
- open orders sum
- closed orders sum
- update time
- high-risk operations count

### Orders
Main order fields include:
- order number
- cashier
- waiter
- floor
- open/close time
- revenue
- order status
- guest count
- tables

Detailed orders can additionally contain:
- terminal group
- tables
- bill time
- banquet flag
- delivery status
- discounts / surcharges / tips
- payments
- order items and modifiers
- delivery/reservation information

### Revenue / payments
The source contract exposes:
- expected revenue
- open orders amount
- closed orders amount
- payments
- surcharges
- discounts

### Meals
The source contract exposes:
- top meals by revenue: name, code, revenue, count
- stop-list remaining meals: id, name, price, amount

### Waiters / operations
The source contract exposes waiter metrics and operations, including:
- waiter id/name
- guest count
- high-risk operations
- open/closed orders
- open/closed order sums
- operation name/count
- high-risk flag
- last action date

### Events
The source contract exposes restaurant event summaries and raw events. Event V2 is explicitly described as returning all raw event data for a restaurant.

## Incoming API envelope

The new `/api/plugin/ingest` endpoint accepts a generic envelope so the website can be prepared before the real plugin is connected:

```json
{
  "event": "order_closed",
  "eventId": "...",
  "timestamp": "...",
  "departmentId": "...",
  "departmentName": "...",
  "pluginId": "...",
  "pluginVersion": "...",
  "currencyCode": "...",
  "groupId": "...",
  "groupName": "...",
  "data": {}
}
```

The API currently validates and normalizes the envelope but intentionally does not persist it until the actual plugin payload is verified.

## Matching rule

When the real plugin payload is connected:

`plugin.departmentId === iikoServer.departmentId` → accept

Otherwise → reject/isolate the event and do not mix it into the restaurant's data.
