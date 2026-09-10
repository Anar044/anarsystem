import 'package:flutter/material.dart';
import 'core/api/iiko_api.dart';
import 'core/config/app_config.dart';
import 'core/storage/connection_storage.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AnarSystemApp());
}

class AnarSystemApp extends StatelessWidget {
  const AnarSystemApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: AppConfig.appName,
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF087FF5)), scaffoldBackgroundColor: const Color(0xFFF5F9FE), cardTheme: const CardTheme(elevation: 0, margin: EdgeInsets.zero, color: Colors.white)),
    home: const StartupPage(),
  );
}

class StartupPage extends StatefulWidget {
  const StartupPage({super.key});
  @override State<StartupPage> createState() => _StartupPageState();
}
class _StartupPageState extends State<StartupPage> {
  IikoConnection? connection;
  bool loading = true;
  @override void initState() { super.initState(); _load(); }
  Future<void> _load() async { final value = await ConnectionStorage().read(); if (!mounted) return; setState(() { connection = value; loading = false; }); }
  @override Widget build(BuildContext context) { if (loading) return const Scaffold(body: Center(child: CircularProgressIndicator())); if (connection == null) return ConnectionPage(onSaved: (v) => setState(() => connection = v)); return AppShell(connection: connection!); }
}

class ConnectionPage extends StatefulWidget {
  final ValueChanged<IikoConnection> onSaved;
  const ConnectionPage({super.key, required this.onSaved});
  @override State<ConnectionPage> createState() => _ConnectionPageState();
}
class _ConnectionPageState extends State<ConnectionPage> {
  final ip = TextEditingController(), port = TextEditingController(text: '80'), login = TextEditingController(), password = TextEditingController();
  bool obscure = true, saving = false;
  @override void dispose() { ip.dispose(); port.dispose(); login.dispose(); password.dispose(); super.dispose(); }
  Future<void> connect() async {
    if ([ip.text, port.text, login.text, password.text].any((v) => v.trim().isEmpty)) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Заполните все поля подключения'))); return; }
    setState(() => saving = true);
    final value = IikoConnection(ip: ip.text.trim(), port: port.text.trim(), login: login.text.trim(), password: password.text);
    try { await ConnectionStorage().save(value); await IikoApi(connection: value).sales(from: DateTime.now(), to: DateTime.now()); if (mounted) widget.onSaved(value); }
    catch (e) { await ConnectionStorage().clear(); if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), duration: const Duration(seconds: 5))); }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 430), child: Card(child: Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    const Icon(Icons.analytics_rounded, size: 54, color: Color(0xFF087FF5)), const SizedBox(height: 14), const Text('AnarSystem', textAlign: TextAlign.center, style: TextStyle(fontSize: 29, fontWeight: FontWeight.w800)), const SizedBox(height: 6), const Text('Подключение к iiko Server', textAlign: TextAlign.center, style: TextStyle(color: Colors.blueGrey)), const SizedBox(height: 28),
    _field(ip, 'IP адрес iiko Server', Icons.dns_outlined), const SizedBox(height: 12), _field(port, 'Порт', Icons.settings_ethernet_outlined, keyboard: TextInputType.number), const SizedBox(height: 12), _field(login, 'Логин', Icons.person_outline), const SizedBox(height: 12),
    TextField(controller: password, obscureText: obscure, decoration: InputDecoration(labelText: 'Пароль', prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(icon: Icon(obscure ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => obscure = !obscure)), border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14))))), const SizedBox(height: 20),
    FilledButton.icon(onPressed: saving ? null : connect, icon: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.link), label: Text(saving ? 'Проверяем подключение…' : 'Подключить'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52))), const SizedBox(height: 12), const Text('Данные подключения сохраняются локально в защищённом хранилище устройства.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.blueGrey)),
  ]))))));
  Widget _field(TextEditingController c, String label, IconData icon, {TextInputType? keyboard}) => TextField(controller: c, keyboardType: keyboard, decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon), border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14)))));
}

class AppShell extends StatefulWidget {
  final IikoConnection connection;
  const AppShell({super.key, required this.connection});
  @override State<AppShell> createState() => _AppShellState();
}
class _AppShellState extends State<AppShell> {
  int index = 0;
  @override Widget build(BuildContext context) {
    final pages = [DashboardPage(connection: widget.connection), SalesPage(connection: widget.connection), OrdersPage(connection: widget.connection), const PlaceholderPage(title: 'Финансы', icon: Icons.account_balance_wallet_outlined), SettingsPage(connection: widget.connection)];
    return Scaffold(body: SafeArea(child: pages[index]), bottomNavigationBar: NavigationBar(selectedIndex: index, onDestinationSelected: (v) => setState(() => index = v), destinations: const [
      NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Главная'), NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Продажи'), NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Заказы'), NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Финансы'), NavigationDestination(icon: Icon(Icons.menu), selectedIcon: Icon(Icons.menu_open), label: 'Ещё')
    ]));
  }
}

class DashboardPage extends StatefulWidget {
  final IikoConnection connection;
  const DashboardPage({super.key, required this.connection});
  @override State<DashboardPage> createState() => _DashboardPageState();
}
class _DashboardPageState extends State<DashboardPage> {
  late final IikoApi api = IikoApi(connection: widget.connection); SalesReport? report; String period = 'Сегодня'; bool loading = true; String? error;
  DateTimeRange range() { final now = DateTime.now(), today = DateTime(now.year, now.month, now.day); if (period == 'Неделя') return DateTimeRange(start: today.subtract(Duration(days: today.weekday - 1)), end: today); if (period == 'Месяц') return DateTimeRange(start: DateTime(today.year, today.month, 1), end: today); return DateTimeRange(start: today, end: today); }
  @override void initState() { super.initState(); load(); }
  Future<void> load() async { setState(() { loading = true; error = null; }); try { final r = range(); final value = await api.sales(from: r.start, to: r.end); if (mounted) setState(() { report = value; loading = false; }); } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); } }
  @override Widget build(BuildContext context) { final data = report; return RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
    Row(children: [const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('AnarSystem', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), SizedBox(height: 3), Text('Аналитика ресторана', style: TextStyle(color: Colors.blueGrey, fontSize: 13))])), IconButton(onPressed: load, icon: const Icon(Icons.refresh))]), const SizedBox(height: 12),
    SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: ['Сегодня', 'Неделя', 'Месяц'].map((item) => Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(item), selected: period == item, onSelected: (_) { setState(() => period = item); load(); }))).toList())), const SizedBox(height: 16),
    if (loading) const Padding(padding: EdgeInsets.all(60), child: Center(child: CircularProgressIndicator())) else if (error != null) ErrorCard(error: error!, onRetry: load) else ...[
      GridView.count(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.35, children: [KpiCard(title: 'Выручка', value: money(data!.revenue), icon: Icons.payments_outlined), KpiCard(title: 'Заказы', value: '${data.orders}', icon: Icons.receipt_long_outlined), KpiCard(title: 'Средний чек', value: money(data.averageCheck), icon: Icons.shopping_bag_outlined), const KpiCard(title: 'Гости', value: '—', icon: Icons.people_outline)]),
      const SizedBox(height: 16), SalesChart(report: data), const SizedBox(height: 16), Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Источник данных', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), const SizedBox(height: 12), const Row(children: [Icon(Icons.check_circle, color: Colors.green, size: 19), SizedBox(width: 8), Expanded(child: Text('iiko Server → AnarSystem API → Mobile'))]), const SizedBox(height: 7), Text('${widget.connection.ip}:${widget.connection.port}', style: const TextStyle(color: Colors.blueGrey, fontSize: 12))])))
    ]
  ])); }
}

class SalesPage extends StatefulWidget { final IikoConnection connection; const SalesPage({super.key, required this.connection}); @override State<SalesPage> createState() => _SalesPageState(); }
class _SalesPageState extends State<SalesPage> {
  late final IikoApi api = IikoApi(connection: widget.connection); SalesReport? report; bool loading = true; String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async { setState(() { loading = true; error = null; }); final now = DateTime.now(); try { final value = await api.sales(from: DateTime(now.year, now.month, now.day), to: DateTime(now.year, now.month, now.day)); if (mounted) setState(() { report = value; loading = false; }); } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); } }
  @override Widget build(BuildContext context) => RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(20), children: [const Text('Продажи', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), const SizedBox(height: 4), const Text('Сегодня • реальные данные iiko', style: TextStyle(color: Colors.blueGrey)), const SizedBox(height: 18), if (loading) const Padding(padding: EdgeInsets.all(50), child: Center(child: CircularProgressIndicator())) else if (error != null) ErrorCard(error: error!, onRetry: load) else Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Общая выручка', style: TextStyle(color: Colors.blueGrey)), const SizedBox(height: 5), Text(money(report!.revenue), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)), const SizedBox(height: 18), Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Заказы: ${report!.orders}'), Text('Средний чек: ${money(report!.averageCheck)}')])])))]));
}

class OrdersPage extends StatefulWidget { final IikoConnection connection; const OrdersPage({super.key, required this.connection}); @override State<OrdersPage> createState() => _OrdersPageState(); }
class _OrdersPageState extends State<OrdersPage> {
  late final IikoApi api = IikoApi(connection: widget.connection); OrdersReport? report; DateTime selectedDate = DateTime.now(); bool loading = true; String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async { setState(() { loading = true; error = null; }); final d = DateTime(selectedDate.year, selectedDate.month, selectedDate.day); try { final value = await api.orders(from: d, to: d); if (mounted) setState(() { report = value; loading = false; }); } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); } }
  Future<void> chooseDate() async { final picked = await showDatePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime.now(), initialDate: selectedDate); if (picked != null) { setState(() => selectedDate = picked); load(); } }
  @override Widget build(BuildContext context) { final data = report; return RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
    Row(children: [const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Заказы', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), SizedBox(height: 3), Text('Заказы из iiko OLAP', style: TextStyle(color: Colors.blueGrey, fontSize: 13))])), IconButton(onPressed: chooseDate, icon: const Icon(Icons.calendar_month_outlined)), IconButton(onPressed: load, icon: const Icon(Icons.refresh))]), const SizedBox(height: 12),
    Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [const Icon(Icons.event_outlined), const SizedBox(width: 10), Expanded(child: Text(formatDate(selectedDate), style: const TextStyle(fontWeight: FontWeight.w700))), TextButton(onPressed: chooseDate, child: const Text('Изменить'))]))), const SizedBox(height: 12),
    if (loading) const Padding(padding: EdgeInsets.all(55), child: Center(child: CircularProgressIndicator())) else if (error != null) ErrorCard(error: error!, onRetry: load) else if (data != null && !data.available) Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(children: [const Icon(Icons.info_outline, size: 42), const SizedBox(height: 10), Text(data.message ?? 'Список заказов недоступен в текущем наборе OLAP-полей.', textAlign: TextAlign.center), const SizedBox(height: 12), const Text('Выручка и количество заказов продолжают работать в разделе «Продажи».', textAlign: TextAlign.center, style: TextStyle(color: Colors.blueGrey))]))) else ...[
      Row(children: [Expanded(child: KpiCard(title: 'Заказы', value: '${data!.count}', icon: Icons.receipt_long_outlined)), const SizedBox(width: 10), Expanded(child: KpiCard(title: 'Выручка', value: money(data.revenue), icon: Icons.payments_outlined))]), const SizedBox(height: 16),
      if (data.orders.isEmpty) Card(child: Padding(padding: const EdgeInsets.all(25), child: Column(children: [const Icon(Icons.receipt_long_outlined, size: 42, color: Colors.blueGrey), const SizedBox(height: 10), const Text('Заказов за выбранную дату нет')]))) else ...data.orders.map((order) => OrderCard(order: order))
    ]
  ])); }
}

class OrderCard extends StatelessWidget { final OrderItem order; const OrderCard({super.key, required this.order}); @override Widget build(BuildContext context) { final details = [if (order.table.isNotEmpty) 'Стол: ${order.table}', if (order.waiter.isNotEmpty) 'Официант: ${order.waiter}', if (order.status.isNotEmpty) order.status].join(' • '); return Card(margin: const EdgeInsets.only(bottom: 9), child: Padding(padding: const EdgeInsets.all(15), child: Row(children: [Container(width: 42, height: 42, decoration: BoxDecoration(color: const Color(0xFFE9F4FF), borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.receipt_long_outlined, color: Color(0xFF087FF5))), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Заказ ${order.number}', style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 5), Text(details.isEmpty ? 'Данные заказа' : details, style: const TextStyle(fontSize: 12, color: Colors.blueGrey))])), Text(money(order.amount), style: const TextStyle(fontWeight: FontWeight.w800))]))); } }

class SalesChart extends StatelessWidget { final SalesReport report; const SalesChart({super.key, required this.report}); @override Widget build(BuildContext context) { final points = [...report.points]..sort((a,b) => a.date.compareTo(b.date)); final max = points.fold<double>(0, (m,p) => p.revenue > m ? p.revenue : m); return Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Выручка по дням', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), const SizedBox(height: 15), if (points.isEmpty) const Text('Нет данных') else ...points.map((p) => Padding(padding: const EdgeInsets.only(bottom: 10), child: Row(children: [SizedBox(width: 48, child: Text('${p.date.day}.${p.date.month.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 11, color: Colors.blueGrey))), Expanded(child: LinearProgressIndicator(value: max == 0 ? 0 : p.revenue / max, minHeight: 9)), const SizedBox(width: 10), SizedBox(width: 72, child: Text(money(p.revenue), textAlign: TextAlign.right, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)))])))]))); } }

class KpiCard extends StatelessWidget { final String title, value; final IconData icon; const KpiCard({super.key, required this.title, required this.value, required this.icon}); @override Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(15), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Container(width: 32, height: 32, decoration: BoxDecoration(color: const Color(0xFFE9F4FF), borderRadius: BorderRadius.circular(9)), child: Icon(icon, size: 18, color: const Color(0xFF087FF5))), const Spacer(), Text(title, style: const TextStyle(color: Colors.blueGrey, fontSize: 12)), const SizedBox(height: 3), Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))]))); }
class ErrorCard extends StatelessWidget { final String error; final VoidCallback onRetry; const ErrorCard({super.key, required this.error, required this.onRetry}); @override Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(children: [const Icon(Icons.cloud_off, size: 42), const SizedBox(height: 10), const Text('Не удалось получить данные', style: TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 6), Text(error, textAlign: TextAlign.center, style: const TextStyle(color: Colors.blueGrey)), const SizedBox(height: 14), FilledButton(onPressed: onRetry, child: const Text('Повторить'))]))); }
class PlaceholderPage extends StatelessWidget { final String title; final IconData icon; const PlaceholderPage({super.key, required this.title, required this.icon}); @override Widget build(BuildContext context) => Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, size: 54, color: const Color(0xFF087FF5)), const SizedBox(height: 12), Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800)), const SizedBox(height: 5), const Text('Модуль будет подключён следующим этапом', style: TextStyle(color: Colors.blueGrey))])); }
class SettingsPage extends StatelessWidget { final IikoConnection connection; const SettingsPage({super.key, required this.connection}); @override Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(20), children: [const Text('Настройки', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), const SizedBox(height: 18), Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('iiko Server', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 12), Text('${connection.ip}:${connection.port}'), const SizedBox(height: 5), Text(connection.login, style: const TextStyle(color: Colors.blueGrey)), const SizedBox(height: 18), const Row(children: [Icon(Icons.lock_outline, size: 18, color: Colors.green), SizedBox(width: 8), Expanded(child: Text('Пароль хранится в защищённом локальном хранилище.'))])]))), const SizedBox(height: 12), Card(child: ListTile(leading: const Icon(Icons.logout), title: const Text('Изменить подключение'), subtitle: const Text('Удалить сохранённые данные iiko'), onTap: () async { await ConnectionStorage().clear(); if (context.mounted) Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const StartupPage()), (_) => false); }))]); }

String money(double value) => '${value.toStringAsFixed(2)} ₼';
String formatDate(DateTime value) => '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}';
