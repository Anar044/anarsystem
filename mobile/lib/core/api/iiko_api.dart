import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../storage/connection_storage.dart';

class SalesPoint {
  final DateTime date;
  final double revenue;
  final int orders;
  const SalesPoint({required this.date, required this.revenue, required this.orders});
}
class SalesReport {
  final List<SalesPoint> points; final double revenue; final int orders;
  const SalesReport({required this.points, required this.revenue, required this.orders});
  double get averageCheck => orders == 0 ? 0 : revenue / orders;
}
class OrderItem {
  final String number; final DateTime? date; final String table; final String waiter; final String status; final double amount;
  const OrderItem({required this.number, required this.date, required this.table, required this.waiter, required this.status, required this.amount});
}
class OrdersReport {
  final List<OrderItem> orders; final double revenue; final bool available; final String? message;
  const OrdersReport({required this.orders, required this.revenue, required this.available, this.message});
  int get count => orders.length;
  double get averageCheck => count == 0 ? 0 : revenue / count;
}
class CashShift {
  final String id, date, status; final DateTime? openTime, closeTime; final Map<String, dynamic> raw;
  const CashShift({required this.id, required this.date, required this.status, required this.openTime, required this.closeTime, required this.raw});
  bool get isOpen => status.toUpperCase() == 'OPEN' || (closeTime == null && status.toUpperCase() != 'CLOSED');
}
class CashShiftPayment {
  final String group, type, comment; final double sum, actualSum;
  const CashShiftPayment({required this.group, required this.sum, required this.actualSum, required this.type, required this.comment});
}
class CashShiftDetail {
  final String sessionId; final Map<String, dynamic> shift; final List<CashShiftPayment> payments;
  const CashShiftDetail({required this.sessionId, required this.shift, required this.payments});
  double get cashless => payments.where((p) => p.group == 'CARD').fold(0, (s, p) => s + p.actualSum);
  double get payIns => payments.where((p) => p.group == 'PAYIN').fold(0, (s, p) => s + p.actualSum);
  double get payOuts => payments.where((p) => p.group == 'PAYOUT').fold(0, (s, p) => s + p.actualSum);
}
class CashShiftsReport {
  final List<CashShift> shifts; final List<Map<String, dynamic>> errors;
  const CashShiftsReport({required this.shifts, required this.errors});
  int get openCount => shifts.where((s) => s.isOpen).length;
  int get closedCount => shifts.length - openCount;
}
class IikoApiException implements Exception {
  final String message; const IikoApiException(this.message);
  @override String toString() => message;
}
class IikoApi {
  final http.Client client; final IikoConnection connection;
  IikoApi({required this.connection, http.Client? client}) : client = client ?? http.Client();
  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final response = await client.post(Uri.parse('${AppConfig.apiBaseUrl}$path'), headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'}, body: jsonEncode(body)).timeout(const Duration(seconds: 45));
    Map<String, dynamic> data = {};
    try { final decoded = jsonDecode(response.body); if (decoded is Map<String, dynamic>) data = decoded; } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300 || data['success'] == false) throw IikoApiException(data['message']?.toString() ?? 'Ошибка API: HTTP ${response.statusCode}');
    return data;
  }
  Map<String, dynamic> _connectionBody({required DateTime from, required DateTime to}) => {'ip': connection.ip, 'port': connection.port, 'login': connection.login, 'password': connection.password, 'from': _date(from), 'to': _date(to)};
  Future<SalesReport> sales({required DateTime from, required DateTime to}) async => _parseReport((await _post('/api/iiko/sales', _connectionBody(from: from, to: to)))['report']);
  Future<OrdersReport> orders({required DateTime from, required DateTime to}) async {
    final data = await _post('/api/iiko/orders', _connectionBody(from: from, to: to)); final rawOrders = data['orders'] is List ? data['orders'] as List : const []; final items = <OrderItem>[];
    for (final raw in rawOrders) { if (raw is! Map) continue; items.add(OrderItem(number: raw['number']?.toString() ?? '', date: DateTime.tryParse(raw['date']?.toString() ?? ''), table: raw['table']?.toString() ?? '', waiter: raw['waiter']?.toString() ?? '', status: raw['status']?.toString() ?? '', amount: _number(raw['amount']))); }
    return OrdersReport(orders: items, revenue: _number((data['summary'] as Map?)?['revenue']), available: data['available'] != false, message: data['message']?.toString());
  }
  Future<CashShiftsReport> cashShifts({required DateTime from, required DateTime to}) async {
    final data = await _post('/api/iiko/cash-shifts', _connectionBody(from: from, to: to)); final raw = data['shifts'] is List ? data['shifts'] as List : const []; final shifts = <CashShift>[];
    for (final item in raw) { if (item is! Map) continue; final m = Map<String, dynamic>.from(item); final id = _first(m, ['_sessionId','id','sessionId','sessionID','uuid','UUID']); final date = _first(m, ['_dateKey','businessDate','operatingDay','date','openDate']); final status = _first(m, ['status','_requestedStatus']); shifts.add(CashShift(id: id, date: date, status: status, openTime: _dateTime(m, ['openTime','openedAt','startTime','openDateTime']), closeTime: _dateTime(m, ['closeTime','closedAt','endTime','closeDateTime']), raw: m)); }
    return CashShiftsReport(shifts: shifts, errors: data['errors'] is List ? (data['errors'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const []);
  }
  Future<CashShiftDetail> cashShiftDetail(String sessionId) async {
    final data = await _post('/api/iiko/cash-shift-detail', {'ip': connection.ip, 'port': connection.port, 'login': connection.login, 'password': connection.password, 'sessionId': sessionId}); final raw = data['payments'] is List ? data['payments'] as List : const []; final payments = <CashShiftPayment>[];
    for (final item in raw) { if (item is! Map) continue; payments.add(CashShiftPayment(group: item['group']?.toString() ?? '', sum: _number(item['sum']), actualSum: _number(item['actualSum'] ?? item['sum']), type: item['type']?.toString() ?? '', comment: item['comment']?.toString() ?? '')); }
    return CashShiftDetail(sessionId: sessionId, shift: data['shift'] is Map ? Map<String, dynamic>.from(data['shift'] as Map) : const {}, payments: payments);
  }
  SalesReport _parseReport(dynamic report) {
    final rows = report is Map<String, dynamic> && report['data'] is List ? report['data'] as List : const []; final points = <SalesPoint>[]; double revenue = 0; int orders = 0;
    for (final raw in rows) { if (raw is! Map) continue; final date = DateTime.tryParse((raw['OpenDate.Typed'] ?? raw['OpenDate'] ?? raw['date'])?.toString() ?? ''); if (date == null) continue; final rowRevenue = _number(raw['DishSumInt'] ?? raw['revenue'] ?? raw['sum']); final rowOrders = _number(raw['UniqOrderId'] ?? raw['orders'] ?? raw['orderCount']).round(); revenue += rowRevenue; orders += rowOrders; points.add(SalesPoint(date: date, revenue: rowRevenue, orders: rowOrders)); }
    if (points.isEmpty && report is Map && report['summary'] is List) for (final raw in report['summary'] as List) { if (raw is! Map) continue; revenue += _number(raw['DishSumInt'] ?? raw['revenue'] ?? raw['sum']); orders += _number(raw['UniqOrderId'] ?? raw['orders'] ?? raw['orderCount']).round(); }
    return SalesReport(points: points, revenue: revenue, orders: orders);
  }
  static String _first(Map<String, dynamic> m, List<String> keys) { for (final k in keys) { final v = m[k]; if (v != null && v.toString().trim().isNotEmpty) return v.toString(); } return ''; }
  static DateTime? _dateTime(Map<String, dynamic> m, List<String> keys) { final v = _first(m, keys); return v.isEmpty ? null : DateTime.tryParse(v); }
  static double _number(dynamic value) { if (value is num) return value.toDouble(); return double.tryParse(value?.toString().replaceAll(',', '.') ?? '') ?? 0; }
  static String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}
