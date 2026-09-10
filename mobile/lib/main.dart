import 'package:flutter/material.dart';

void main() => runApp(const AnarSystemApp());

class AnarSystemApp extends StatelessWidget {
  const AnarSystemApp({super.key});

  @override
  Widget build(BuildContext context) {
    const primary = Color(0xFF087FF5);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'AnarSystem',
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'SF Pro Display',
        colorScheme: ColorScheme.fromSeed(seedColor: primary, brightness: Brightness.light),
        scaffoldBackgroundColor: const Color(0xFFF5F9FE),
        cardTheme: const CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(18))),
        ),
      ),
      home: const AppShell(),
    );
  }
}

class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int index = 0;
  final pages = const [
    DashboardPage(),
    SalesPage(),
    OrdersPage(),
    FinancePage(),
    MorePage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: pages[index]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        height: 72,
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

class PageHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  const PageHeader({super.key, required this.title, this.subtitle, this.trailing});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 12),
    child: Row(children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w750, letterSpacing: -0.5)),
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Text(subtitle!, style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 13)),
        ],
      ])),
      if (trailing != null) trailing!,
    ]),
  );
}

class FilterPill extends StatelessWidget {
  final String text;
  final bool active;
  const FilterPill(this.text, {super.key, this.active = false});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
    decoration: BoxDecoration(
      color: active ? const Color(0xFF087FF5) : const Color(0xFFEAF3FC),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: active ? Colors.white : const Color(0xFF315B82))),
  );
}

class KpiCard extends StatelessWidget {
  final String title, value, change;
  final IconData icon;
  final bool positive;
  const KpiCard({super.key, required this.title, required this.value, required this.change, required this.icon, this.positive = true});
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(padding: const EdgeInsets.all(15), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(width: 30, height: 30, decoration: BoxDecoration(color: const Color(0xFFE9F4FF), borderRadius: BorderRadius.circular(9)), child: Icon(icon, size: 17, color: const Color(0xFF087FF5))),
        const Spacer(),
        Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4), decoration: BoxDecoration(color: positive ? const Color(0xFFE8FAF2) : const Color(0xFFFFEEEE), borderRadius: BorderRadius.circular(8)), child: Text(change, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: positive ? const Color(0xFF13A66A) : const Color(0xFFE55252)))),
      ]),
      const SizedBox(height: 12),
      Text(title, style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 12)),
      const SizedBox(height: 3),
      Text(value, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w750)),
    ])),
  );
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});
  @override
  Widget build(BuildContext context) => CustomScrollView(slivers: [
    SliverToBoxAdapter(child: PageHeader(
      title: 'Доброе утро, Анар! 👋',
      subtitle: 'Main Restaurant • Сегодня, 10 сентября',
      trailing: Stack(children: [const Icon(Icons.notifications_none, size: 27), Positioned(right: 2, top: 1, child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle)))]),
    )),
    SliverPadding(padding: const EdgeInsets.symmetric(horizontal: 20), sliver: SliverToBoxAdapter(child: Row(children: const [FilterPill('Сегодня', active: true), SizedBox(width: 8), FilterPill('Неделя'), SizedBox(width: 8), FilterPill('Месяц'), SizedBox(width: 8), FilterPill('Год')]))),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 0), sliver: SliverGrid.count(crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.28, children: const [
      KpiCard(title: 'Выручка', value: '4 850 ₼', change: '+12%', icon: Icons.payments_outlined),
      KpiCard(title: 'Заказы', value: '327', change: '+8%', icon: Icons.receipt_long_outlined),
      KpiCard(title: 'Средний чек', value: '14.83 ₼', change: '+4%', icon: Icons.shopping_bag_outlined),
      KpiCard(title: 'Гости', value: '295', change: '+11%', icon: Icons.people_outline),
    ])),
    SliverPadding(padding: const EdgeInsets.all(20), sliver: SliverToBoxAdapter(child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Выручка по часам', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
      const SizedBox(height: 5),
      Text('Сегодня', style: TextStyle(color: Colors.blueGrey.shade500, fontSize: 12)),
      const SizedBox(height: 16),
      SizedBox(height: 150, child: CustomPaint(painter: SalesChartPainter())),
    ])))),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), sliver: SliverToBoxAdapter(child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(children: [
      Row(children: const [Text('Сравнение', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)), Spacer(), Text('к прошлому периоду', style: TextStyle(color: Colors.blueGrey, fontSize: 12))]),
      const SizedBox(height: 15),
      const Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        _Compare(label: 'Сегодня', value: '4 850 ₼', change: '+12%'),
        _Compare(label: 'Прошлый период', value: '4 320 ₼', change: ''),
      ]),
    ])))),
  ]);
}

class _Compare extends StatelessWidget {
  final String label, value, change;
  const _Compare({required this.label, required this.value, required this.change});
  @override Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 11, color: Colors.blueGrey)), const SizedBox(height: 3), Row(children: [Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w750)), if (change.isNotEmpty) ...[const SizedBox(width: 6), Text(change, style: const TextStyle(color: Color(0xFF13A66A), fontWeight: FontWeight.w700, fontSize: 11))]])]);
}

class SalesPage extends StatelessWidget {
  const SalesPage({super.key});
  @override
  Widget build(BuildContext context) => CustomScrollView(slivers: [
    const SliverToBoxAdapter(child: PageHeader(title: 'Продажи', subtitle: '10.09.2026 — 10.09.2026', trailing: Icon(Icons.search))),
    SliverPadding(padding: const EdgeInsets.symmetric(horizontal: 20), sliver: SliverToBoxAdapter(child: Row(children: const [FilterPill('Выручка', active: true), SizedBox(width: 7), FilterPill('Категории'), SizedBox(width: 7), FilterPill('Блюда'), SizedBox(width: 7), FilterPill('Точки')]))),
    SliverPadding(padding: const EdgeInsets.all(20), sliver: SliverToBoxAdapter(child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Общая выручка', style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 12)),
      const SizedBox(height: 4), const Text('4 850 ₼', style: TextStyle(fontSize: 29, fontWeight: FontWeight.w800)),
      const SizedBox(height: 4), const Text('+12% к прошлому периоду', style: TextStyle(color: Color(0xFF13A66A), fontWeight: FontWeight.w700, fontSize: 12)),
      const SizedBox(height: 20), SizedBox(height: 190, child: CustomPaint(painter: SalesChartPainter(bars: true))),
      const Divider(height: 28),
      const _PaymentRow(color: Color(0xFF2588F7), name: 'Наличные', value: '1 920 ₼', percent: '40%'),
      const _PaymentRow(color: Color(0xFF14B88A), name: 'Карта', value: '2 310 ₼', percent: '48%'),
      const _PaymentRow(color: Color(0xFFFF5C6C), name: 'Другое', value: '620 ₼', percent: '12%'),
    ])))),
  ]);
}

class _PaymentRow extends StatelessWidget { final Color color; final String name, value, percent; const _PaymentRow({required this.color, required this.name, required this.value, required this.percent}); @override Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [Container(width: 9, height: 9, decoration: BoxDecoration(color: color, shape: BoxShape.circle)), const SizedBox(width: 9), Expanded(child: Text(name, style: const TextStyle(fontSize: 13))), Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)), const SizedBox(width: 8), Text(percent, style: const TextStyle(color: Colors.blueGrey, fontSize: 12))])); }

class OrdersPage extends StatelessWidget {
  const OrdersPage({super.key});
  final orders = const [('#1256', '12:24', 'Стол 8', 'Иванов А.', '45.00 ₼', true), ('#1255', '12:20', 'Стол 3', 'Касимова Н.', '28.50 ₼', true), ('#1254', '12:18', 'Доставка', '', '36.00 ₼', false), ('#1253', '12:15', 'Стол 1', 'Иванов А.', '18.00 ₼', false), ('#1251', '12:05', 'Стол 7', 'Керимов Н.', '52.00 ₼', false)];
  @override
  Widget build(BuildContext context) => CustomScrollView(slivers: [
    const SliverToBoxAdapter(child: PageHeader(title: 'Заказы', subtitle: 'Сегодня', trailing: Icon(Icons.search))),
    const SliverPadding(padding: EdgeInsets.symmetric(horizontal: 20), sliver: SliverToBoxAdapter(child: Row(children: [FilterPill('Все', active: true), SizedBox(width: 8), FilterPill('Открытые'), SizedBox(width: 8), FilterPill('Закрытые')]))),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 20), sliver: SliverList(delegate: SliverChildBuilderDelegate((context, i) { final o = orders[i]; return Padding(padding: const EdgeInsets.only(bottom: 9), child: Card(child: ListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 5), leading: Container(width: 42, height: 42, decoration: BoxDecoration(color: const Color(0xFFEAF3FC), borderRadius: BorderRadius.circular(12)), child: Center(child: Text(o.$1.substring(1), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800)))), title: Row(children: [Text(o.$1, style: const TextStyle(fontWeight: FontWeight.w700)), const Spacer(), Text(o.$5, style: const TextStyle(fontWeight: FontWeight.w800))]), subtitle: Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [Text('${o.$2} • ${o.$3}', style: const TextStyle(fontSize: 11, color: Colors.blueGrey)), if (o.$4.isNotEmpty) Text(' • ${o.$4}', style: const TextStyle(fontSize: 11, color: Colors.blueGrey)), const Spacer(), Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4), decoration: BoxDecoration(color: o.$6 ? const Color(0xFFFFF0E4) : const Color(0xFFE8FAF2), borderRadius: BorderRadius.circular(7)), child: Text(o.$6 ? 'Открыт' : 'Закрыт', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: o.$6 ? const Color(0xFFCC7629) : const Color(0xFF13A66A))))])))); }, childCount: orders.length))),
  ]);
}

class FinancePage extends StatelessWidget {
  const FinancePage({super.key});
  @override
  Widget build(BuildContext context) => CustomScrollView(slivers: [
    const SliverToBoxAdapter(child: PageHeader(title: 'Финансы', subtitle: 'P&L • Сентябрь 2026', trailing: Icon(Icons.tune))),
    const SliverPadding(padding: EdgeInsets.symmetric(horizontal: 20), sliver: SliverToBoxAdapter(child: Row(children: [FilterPill('Обзор', active: true), SizedBox(width: 8), FilterPill('Доходы'), SizedBox(width: 8), FilterPill('Расходы'), SizedBox(width: 8), FilterPill('Прибыль')]))),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 20), sliver: SliverList(delegate: SliverChildListDelegate([
      const KpiCard(title: 'Выручка', value: '125 430 ₼', change: '+8%', icon: Icons.payments_outlined), const SizedBox(height: 10),
      const KpiCard(title: 'Себестоимость', value: '−38 210 ₼', change: '+6%', icon: Icons.inventory_2_outlined, positive: false), const SizedBox(height: 10),
      const KpiCard(title: 'Валовая прибыль', value: '87 220 ₼', change: '+70%', icon: Icons.trending_up), const SizedBox(height: 10),
      const KpiCard(title: 'Операционные расходы', value: '−52 600 ₼', change: '+42%', icon: Icons.account_balance_outlined, positive: false), const SizedBox(height: 10),
      const KpiCard(title: 'Чистая прибыль', value: '34 620 ₼', change: '+28%', icon: Icons.savings_outlined),
    ]))),
  ]);
}

class MorePage extends StatelessWidget {
  const MorePage({super.key});
  final items = const [
    ('OLAP отчёты', Icons.analytics_outlined), ('Аналитика', Icons.insights_outlined), ('Кассы и смены', Icons.point_of_sale_outlined), ('Склад и списания', Icons.inventory_2_outlined), ('Сотрудники', Icons.people_outline), ('Отчёты', Icons.description_outlined), ('Настройки', Icons.settings_outlined),
  ];
  @override
  Widget build(BuildContext context) => CustomScrollView(slivers: [
    const SliverToBoxAdapter(child: PageHeader(title: 'Ещё', subtitle: 'Все модули AnarSystem')),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 4, 20, 20), sliver: SliverList(delegate: SliverChildBuilderDelegate((context, i) => Padding(padding: const EdgeInsets.only(bottom: 9), child: Card(child: ListTile(contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 3), leading: Container(width: 40, height: 40, decoration: BoxDecoration(color: const Color(0xFFEAF3FC), borderRadius: BorderRadius.circular(12)), child: Icon(items[i].$2, color: const Color(0xFF087FF5), size: 20)), title: Text(items[i].$1, style: const TextStyle(fontWeight: FontWeight.w650)), trailing: const Icon(Icons.chevron_right, color: Colors.blueGrey))), childCount: items.length))),
    SliverPadding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 30), sliver: SliverToBoxAdapter(child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [Text('Будущие модули', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w750)), SizedBox(height: 6), Text('Функциональность будет расширяться без изменения основной навигации.', style: TextStyle(color: Colors.blueGrey, fontSize: 12)), SizedBox(height: 14), Text('✓ CRM и лояльность\n✓ Планирование\n✓ Бюджетирование\n✓ AI-рекомендации', style: TextStyle(height: 1.9, fontSize: 13))])))),
  ]);
}

class SalesChartPainter extends CustomPainter {
  final bool bars;
  SalesChartPainter({this.bars = false});
  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()..color = const Color(0xFFE8F0F7)..strokeWidth = 1;
    for (var i = 1; i < 5; i++) canvas.drawLine(Offset(0, size.height * i / 5), Offset(size.width, size.height * i / 5), grid);
    if (bars) {
      final bar = Paint()..color = const Color(0xFF8BC4FA);
      const vals = [0.25, 0.38, 0.3, 0.52, 0.47, 0.7, 0.55, 0.83, 0.65, 0.9, 0.78, 0.96];
      final w = size.width / vals.length * .58;
      for (var i = 0; i < vals.length; i++) { final h = size.height * vals[i]; canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(i * size.width / vals.length + 5, size.height - h, w, h), const Radius.circular(5)), bar); }
    } else {
      final line = Paint()..color = const Color(0xFF087FF5)..strokeWidth = 3..style = PaintingStyle.stroke..strokeCap = StrokeCap.round;
      final fill = Path(); final path = Path();
      const vals = [0.18, 0.28, 0.22, 0.42, 0.36, 0.56, 0.45, 0.72, 0.62, 0.8, 0.73, 0.9];
      for (var i = 0; i < vals.length; i++) { final p = Offset(i * size.width / (vals.length - 1), size.height * (1 - vals[i])); if (i == 0) { path.moveTo(p.dx, p.dy); fill.moveTo(p.dx, size.height); fill.lineTo(p.dx, p.dy); } else { path.lineTo(p.dx, p.dy); fill.lineTo(p.dx, p.dy); } }
      fill.lineTo(size.width, size.height); fill.close(); canvas.drawPath(fill, Paint()..color = const Color(0x1A087FF5)); canvas.drawPath(path, line);
    }
  }
  @override bool shouldRepaint(covariant SalesChartPainter oldDelegate) => oldDelegate.bars != bars;
}
