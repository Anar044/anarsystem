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
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: AppConfig.appName,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF087FF5)),
        scaffoldBackgroundColor: const Color(0xFFF5F9FE),
        cardTheme: const CardTheme(
          elevation: 0,
          margin: EdgeInsets.zero,
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(18))),
        ),
      ),
      home: const StartupPage(),
    );
  }
}

class StartupPage extends StatefulWidget {
  const StartupPage({super.key});
  @override
  State<StartupPage> createState() => _StartupPageState();
}

class _StartupPageState extends State<StartupPage> {
  final storage = ConnectionStorage();
  IikoConnection? connection;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final value = await storage.read();
    if (!mounted) return;
    setState(() {
      connection = value;
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (connection == null) return ConnectionPage(onSaved: (value) => setState(() => connection = value));
    return AppShell(connection: connection!);
  }
}

class ConnectionPage extends StatefulWidget {
  final ValueChanged<IikoConnection> onSaved;
  const ConnectionPage({super.key, required this.onSaved});
  @override
  State<ConnectionPage> createState() => _ConnectionPageState();
}

class _ConnectionPageState extends State<ConnectionPage> {
  final ip = TextEditingController();
  final port = TextEditingController(text: '80');
  final login = TextEditingController();
  final password = TextEditingController();
  bool obscure = true;
  bool saving = false;

  @override
  void dispose() {
    ip.dispose(); port.dispose(); login.dispose(); password.dispose();
    super.dispose();
  }

  Future<void> connect() async {
    if (ip.text.trim().isEmpty || port.text.trim().isEmpty || login.text.trim().isEmpty || password.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Заполните все поля подключения')));
      return;
    }
    setState(() => saving = true);
    final value = IikoConnection(ip: ip.text, port: port.text, login: login.text, password: password.text);
    try {
      await ConnectionStorage().save(value);
      await IikoApi(connection: value).sales(from: DateTime.now(), to: DateTime.now());
      if (!mounted) return;
      widget.onSaved(value);
    } catch (e) {
      await ConnectionStorage().clear();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), duration: const Duration(seconds: 5)));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 430),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  const Icon(Icons.analytics_rounded, size: 54, color: Color(0xFF087FF5)),
                  const SizedBox(height: 14),
                  const Text('AnarSystem', textAlign: TextAlign.center, style: TextStyle(fontSize: 29, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text('Подключение к iiko Server', textAlign: TextAlign.center, style: TextStyle(color: Colors.blueGrey.shade600)),
                  const SizedBox(height: 28),
                  _field(ip, 'IP адрес iiko Server', Icons.dns_outlined),
                  const SizedBox(height: 12),
                  _field(port, 'Порт', Icons.settings_ethernet_outlined, keyboard: TextInputType.number),
                  const SizedBox(height: 12),
                  _field(login, 'Логин', Icons.person_outline),
                  const SizedBox(height: 12),
                  TextField(controller: password, obscureText: obscure, decoration: InputDecoration(labelText: 'Пароль', prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(icon: Icon(obscure ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => obscure = !obscure)), border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14))))),
                  const SizedBox(height: 20),
                  FilledButton.icon(onPressed: saving ? null : connect, icon: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.link), label: Text(saving ? 'Проверяем подключение…' : 'Подключить'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)))),
                  const SizedBox(height: 12),
                  Text('Данные подключения сохраняются локально в защищённом хранилище устройства.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.blueGrey.shade500)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController controller, String label, IconData icon, {TextInputType? keyboard}) => TextField(controller: controller, keyboardType: keyboard, decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon), border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14)))));
}

class AppShell extends StatefulWidget {
  final IikoConnection connection;
  const AppShell({super.key, required this.connection});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardPage(connection: widget.connection),
      SalesPage(connection: widget.connection),
      const PlaceholderPage(title: 'Заказы', icon: Icons.receipt_long_outlined),
      const PlaceholderPage(title: 'Финансы', icon: Icons.account_balance_wallet_outlined),
      SettingsPage(connection: widget.connection),
    ];
    return Scaffold(
      body: SafeArea(child: pages[index]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Главная'),
          NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Продажи'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Заказы'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Финансы'),
          NavigationDestination(icon: Icon(Icons.menu), selectedIcon: Icon(Icons.menu_open), label: 'Ещё'),
        ],
      ),
    );
  }
}

class DashboardPage extends StatefulWidget {
  final IikoConnection connection;
  const DashboardPage({super.key, required this.connection});
  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  late IikoApi api;
  SalesReport? report;
  String period = 'Сегодня';
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    api = IikoApi(connection: widget.connection);
    load();
  }

  DateTimeRange _range() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    if (period == 'Неделя') return DateTimeRange(start: today.subtract(Duration(days: today.weekday - 1)), end: today);
    if (period == 'Месяц') return DateTimeRange(start: DateTime(today.year, today.month, 1), end: today);
    return DateTimeRange(start: today, end: today);
  }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final range = _range();
      final value = await api.sales(from: range.start, to: range.end);
      if (mounted) setState(() { report = value; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = e.toString(); loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = report;
    return RefreshIndicator(
      onRefresh: load,
      child: CustomScrollView(slivers: [
        SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.fromLTRB(20, 16, 20, 12), child: Row(children: [
          const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('AnarSystem', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), SizedBox(height: 3), Text('Аналитика ресторана', style: TextStyle(color: Colors.blueGrey, fontSize: 13))])),
          IconButton(onPressed: load, icon: const Icon(Icons.refresh)),
        ]))),
        SliverToBoxAdapter(child: SizedBox(height: 48, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 20), children: ['Сегодня', 'Неделя', 'Месяц'].map((item) => Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(item), selected: period == item, onSelected: (_) { setState(() => period = item); load(); }))).toList()))),
        if (loading) const SliverFillRemaining(hasScrollBody: false, child: Center(child: CircularProgressIndicator()))
        else if (error != null) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(20), child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(children: [const Icon(Icons.cloud_off, size: 42), const SizedBox(height: 10), const Text('Не удалось получить данные', style: TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 6), Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.blueGrey)), const SizedBox(height: 14), FilledButton(onPressed: load, child: const Text('Повторить'))])))))
        else ...[
          SliverPadding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 0), sliver: SliverGrid.count(crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.35, children: [
            KpiCard(title: 'Выручка', value: money(data!.revenue), icon: Icons.payments_outlined),
            KpiCard(title: 'Заказы', value: '${data.orders}', icon: Icons.receipt_long_outlined),
            KpiCard(title: 'Средний чек', value: money(data.averageCheck), icon: Icons.shopping_bag_outlined),
            const KpiCard(title: 'Гости', value: '—', icon: Icons.people_outline),
          ])),
          SliverPadding(padding: const EdgeInsets.all(20), sliver: SliverToBoxAdapter(child: SalesChart(report: data))),
          SliverPadding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 24), sliver: SliverToBoxAdapter(child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Источник данных', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 12),
            Row(children: [const Icon(Icons.check_circle, color: Colors.green, size: 19), const SizedBox(width: 8), const Expanded(child: Text('iiko Server → AnarSystem API → Mobile'))]),
            const SizedBox(height: 7),
            Text('${widget.connection.ip}:${widget.connection.port}', style: const TextStyle(color: Colors.blueGrey, fontSize: 12)),
          ]))))),
        ],
        const SliverToBoxAdapter(child: SizedBox(height: 12)),
      ]),
    );
  }
}

class SalesPage extends StatefulWidget {
  final IikoConnection connection;
  const SalesPage({super.key, required this.connection});
  @override
  State<SalesPage> createState() => _SalesPageState();
}

class _SalesPageState extends State<SalesPage> {
  late IikoApi api;
  SalesReport? report;
  bool loading = true;
  String? error;

  @override
  void initState() { super.initState(); api = IikoApi(connection: widget.connection); load(); }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    final now = DateTime.now();
    try {
      final value = await api.sales(from: DateTime(now.year, now.month, now.day), to: DateTime(now.year, now.month, now.day));
      if (mounted) setState(() { report = value; loading = false; });
    } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(20), children: [
    const Text('Продажи', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
    const SizedBox(height: 4), const Text('Сегодня • реальные данные iiko', style: TextStyle(color: Colors.blueGrey)),
    const SizedBox(height: 18),
    if (loading) const Padding(padding: EdgeInsets.all(50), child: Center(child: CircularProgressIndicator()))
    else if (error != null) Card(child: Padding(padding: const EdgeInsets.all(18), child: Text(error!)))
    else Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Общая выручка', style: TextStyle(color: Colors.blueGrey)), const SizedBox(height: 5),
      Text(money(report!.revenue), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
      const SizedBox(height: 18),
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Заказы: ${report!.orders}'), Text('Средний чек: ${money(report!.averageCheck)}')]),
    ]))),
  ]));
}

class KpiCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  const KpiCard({super.key, required this.title, required this.value, required this.icon});
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(15), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Container(width: 32, height: 32, decoration: BoxDecoration(color: const Color(0xFFE9F4FF), borderRadius: BorderRadius.circular(9)), child: Icon(icon, size: 18, color: const Color(0xFF087FF5))),
    const Spacer(), Text(title, style: const TextStyle(color: Colors.blueGrey, fontSize: 12)), const SizedBox(height: 3), Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
  ])));
}

class SalesChart extends StatelessWidget {
  final SalesReport report;
  const SalesChart({super.key, required this.report});
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Text('Выручка по дням', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), const SizedBox(height: 5),
    const Text('Данные из iiko OLAP', style: TextStyle(color: Colors.blueGrey, fontSize: 12)), const SizedBox(height: 18),
    SizedBox(height: 150, child: CustomPaint(painter: ChartPainter(report.points))),
  ])));
}

class ChartPainter extends CustomPainter {
  final List<SalesPoint> points;
  ChartPainter(this.points);
  @override
  void paint(Canvas canvas, Size size) {
    final axis = Paint()..color = const Color(0xFFD9E4EE)..strokeWidth = 1;
    canvas.drawLine(Offset(0, size.height - 1), Offset(size.width, size.height - 1), axis);
    if (points.isEmpty) return;
    final max = points.map((e) => e.revenue).reduce((a, b) => a > b ? a : b);
    if (max <= 0) return;
    final line = Paint()..color = const Color(0xFF087FF5)..strokeWidth = 3..style = PaintingStyle.stroke;
    final fill = Paint()..color = const Color(0xFF087FF5).withValues(alpha: .10)..style = PaintingStyle.fill;
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final x = points.length == 1 ? size.width / 2 : i * size.width / (points.length - 1);
      final y = size.height - (points[i].revenue / max) * (size.height - 12);
      if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    final fillPath = Path.from(path)..lineTo(size.width, size.height)..lineTo(0, size.height)..close();
    canvas.drawPath(fillPath, fill);
    canvas.drawPath(path, line);
  }
  @override
  bool shouldRepaint(covariant ChartPainter oldDelegate) => oldDelegate.points != points;
}

class PlaceholderPage extends StatelessWidget {
  final String title;
  final IconData icon;
  const PlaceholderPage({super.key, required this.title, required this.icon});
  @override
  Widget build(BuildContext context) => Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, size: 54, color: const Color(0xFF087FF5)), const SizedBox(height: 12), Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800)), const SizedBox(height: 5), const Text('Модуль будет подключён следующим этапом', style: TextStyle(color: Colors.blueGrey))]));
}

class SettingsPage extends StatelessWidget {
  final IikoConnection connection;
  const SettingsPage({super.key, required this.connection});
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(20), children: [
    const Text('Ещё', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), const SizedBox(height: 18),
    Card(child: ListTile(leading: const Icon(Icons.dns_outlined), title: const Text('iiko Server'), subtitle: Text('${connection.ip}:${connection.port}'), trailing: const Icon(Icons.check_circle, color: Colors.green))),
    const SizedBox(height: 10),
    Card(child: ListTile(leading: const Icon(Icons.lock_outline), title: const Text('Защищённое хранилище'), subtitle: const Text('Данные подключения сохранены на устройстве'))),
  ]);
}

String money(double value) => '${value.toStringAsFixed(2).replaceAll('.', ',')} ₼';
