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
  final List<SalesPoint> points;
  final double revenue;
  final int orders;
  const SalesReport({required this.points, required this.revenue, required this.orders});
  double get averageCheck => orders == 0 ? 0 : revenue / orders;
}

class OrderItem {
  final String number;
  final DateTime? date;
  final String table;
  final String waiter;
  final String status;
  final double amount;
  const OrderItem({required this.number, required this.date, required this.table, required this.waiter, required this.status, required this.amount});
}

class OrdersReport {
  final List<OrderItem> orders;
  final double revenue;
  final bool available;
  final String? message;
  const OrdersReport({required this.orders, required this.revenue, required this.available, this.message});
  int get count => orders.length;
  double get averageCheck => count == 0 ? 0 : revenue / count;
}

class IikoApiException implements Exception {
  final String message;
  const IikoApiException(this.message);
  @override
  String toString() => message;
}

class IikoApi {
  final http.Client client;
  final IikoConnection connection;
  IikoApi({required this.connection, http.Client? client}) : client = client ?? http.Client();

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final response = await client.post(Uri.parse('${AppConfig.apiBaseUrl}$path'), headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'}, body: jsonEncode(body)).timeout(const Duration(seconds: 45));
    Map<String, dynamic> data = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {}
    if (response.statusCode < 200 || response.statusCode >= 300 || data['success'] == false) {
      throw IikoApiException(data['message']?.toString() ?? 'Ошибка API: HTTP ${response.statusCode}');
    }
    return data;
  }

  Map<String, dynamic> _connectionBody({required DateTime from, required DateTime to}) => {
    'ip': connection.ip,
    'port': connection.port,
    'login': connection.login,
    'password': connection.password,
    'from': _date(from),
    'to': _date(to),
  };

  Future<SalesReport> sales({required DateTime from, required DateTime to}) async {
    final data = await _post('/api/iiko/sales', _connectionBody(from: from, to: to));
    return _parseReport(data['report']);
  }

  Future<OrdersReport> orders({required DateTime from, required DateTime to}) async {
    final data = await _post('/api/iiko/orders', _connectionBody(from: from, to: to));
    final rawOrders = data['orders'] is List ? data['orders'] as List : const [];
    final items = <OrderItem>[];
    for (final raw in rawOrders) {
      if (raw is! Map) continue;
      items.add(OrderItem(
        number: raw['number']?.toString() ?? '',
        date: DateTime.tryParse(raw['date']?.toString() ?? ''),
        table: raw['table']?.toString() ?? '',
        waiter: raw['waiter']?.toString() ?? '',
        status: raw['status']?.toString() ?? '',
        amount: _number(raw['amount']),
      ));
    }
    return OrdersReport(orders: items, revenue: _number((data['summary'] as Map?)?['revenue']), available: data['available'] != false, message: data['message']?.toString());
  }

  SalesReport _parseReport(dynamic report) {
    final rows = report is Map<String, dynamic> && report['data'] is List ? report['data'] as List : const [];
    final points = <SalesPoint>[];
    double revenue = 0;
    int orders = 0;
    for (final raw in rows) {
      if (raw is! Map) continue;
      final date = DateTime.tryParse((raw['OpenDate.Typed'] ?? raw['OpenDate'] ?? raw['date'])?.toString() ?? '');
      if (date == null) continue;
      final rowRevenue = _number(raw['DishSumInt'] ?? raw['revenue'] ?? raw['sum']);
      final rowOrders = _number(raw['UniqOrderId'] ?? raw['orders'] ?? raw['orderCount']).round();
      revenue += rowRevenue;
      orders += rowOrders;
      points.add(SalesPoint(date: date, revenue: rowRevenue, orders: rowOrders));
    }
    if (points.isEmpty && report is Map && report['summary'] is List) {
      for (final raw in report['summary'] as List) {
        if (raw is! Map) continue;
        revenue += _number(raw['DishSumInt'] ?? raw['revenue'] ?? raw['sum']);
        orders += _number(raw['UniqOrderId'] ?? raw['orders'] ?? raw['orderCount']).round();
      }
    }
    return SalesReport(points: points, revenue: revenue, orders: orders);
  }

  static double _number(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString().replaceAll(',', '.') ?? '') ?? 0;
  }

  static String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}
