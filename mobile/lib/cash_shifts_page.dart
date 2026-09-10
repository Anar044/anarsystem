import 'package:flutter/material.dart';
import 'core/api/iiko_api.dart';
import 'core/storage/connection_storage.dart';

class CashShiftsPage extends StatefulWidget {
  final IikoConnection connection;
  const CashShiftsPage({super.key, required this.connection});
  @override State<CashShiftsPage> createState() => _CashShiftsPageState();
}

class _CashShiftsPageState extends State<CashShiftsPage> {
  late final IikoApi api = IikoApi(connection: widget.connection);
  CashShiftsReport? report;
  DateTime selectedDate = DateTime.now();
  bool loading = true;
  String? error;

  @override void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    final d = DateTime(selectedDate.year, selectedDate.month, selectedDate.day);
    try {
      final value = await api.cashShifts(from: d, to: d);
      if (mounted) setState(() { report = value; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = e.toString(); loading = false; });
    }
  }

  Future<void> chooseDate() async {
    final picked = await showDatePicker(context: context, firstDate: DateTime(2020), lastDate: DateTime.now(), initialDate: selectedDate);
    if (picked != null) { setState(() => selectedDate = picked); load(); }
  }

  Future<void> showDetails(CashShift shift) async {
    if (shift.id.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('У смены нет ID для получения деталей'))); return; }
    showModalBottomSheet(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => CashShiftDetailsSheet(api: api, shift: shift));
  }

  @override Widget build(BuildContext context) {
    final data = report;
    return RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
      Row(children: [const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Кассовые смены', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), SizedBox(height: 3), Text('Реальные данные iiko Server', style: TextStyle(color: Colors.blueGrey, fontSize: 13))])), IconButton(onPressed: chooseDate, icon: const Icon(Icons.calendar_month_outlined)), IconButton(onPressed: load, icon: const Icon(Icons.refresh))]),
      const SizedBox(height: 12),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [const Icon(Icons.event_outlined), const SizedBox(width: 10), Expanded(child: Text(formatDate(selectedDate), style: const TextStyle(fontWeight: FontWeight.w700))), TextButton(onPressed: chooseDate, child: const Text('Изменить'))]))),
      const SizedBox(height: 12),
      if (loading) const Padding(padding: EdgeInsets.all(60), child: Center(child: CircularProgressIndicator()))
      else if (error != null) ErrorCard(error: error!, onRetry: load)
      else if (data != null) ...[
        Row(children: [Expanded(child: _MiniKpi(title: 'Открытые', value: '${data.openCount}', icon: Icons.lock_open_outlined)), const SizedBox(width: 10), Expanded(child: _MiniKpi(title: 'Закрытые', value: '${data.closedCount}', icon: Icons.lock_outline))]),
        const SizedBox(height: 16),
        if (data.shifts.isEmpty) Card(child: Padding(padding: const EdgeInsets.all(28), child: Column(children: [const Icon(Icons.point_of_sale_outlined, size: 44, color: Colors.blueGrey), const SizedBox(height: 10), const Text('За выбранную дату смен нет')]))),
        ...data.shifts.map((shift) => _ShiftCard(shift: shift, onTap: () => showDetails(shift))),
        if (data.errors.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Некоторые запросы iiko не вернули данные: ${data.errors.length}', style: const TextStyle(color: Colors.orange, fontSize: 12))),
      ],
    ]));
  }
}

class _MiniKpi extends StatelessWidget {
  final String title, value; final IconData icon;
  const _MiniKpi({required this.title, required this.value, required this.icon});
  @override Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [Icon(icon, color: const Color(0xFF087FF5)), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: Colors.blueGrey, fontSize: 12)), const SizedBox(height: 3), Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))]))])));
}

class _ShiftCard extends StatelessWidget {
  final CashShift shift; final VoidCallback onTap;
  const _ShiftCard({required this.shift, required this.onTap});
  @override Widget build(BuildContext context) {
    final open = shift.isOpen;
    return Card(margin: const EdgeInsets.only(bottom: 9), child: InkWell(borderRadius: BorderRadius.circular(18), onTap: onTap, child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [
      Container(width: 44, height: 44, decoration: BoxDecoration(color: open ? const Color(0xFFE9F4FF) : const Color(0xFFF0F2F5), borderRadius: BorderRadius.circular(12)), child: Icon(open ? Icons.lock_open_outlined : Icons.lock_outline, color: open ? const Color(0xFF087FF5) : Colors.blueGrey)),
      const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(shift.id.isEmpty ? 'Смена' : 'Смена ${shift.id}', style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 4), Text([if (shift.date.isNotEmpty) shift.date, if (shift.status.isNotEmpty) shift.status].join(' • '), style: const TextStyle(color: Colors.blueGrey, fontSize: 12))])),
      const Icon(Icons.chevron_right),
    ]))));
  }
}

class CashShiftDetailsSheet extends StatefulWidget {
  final IikoApi api; final CashShift shift;
  const CashShiftDetailsSheet({super.key, required this.api, required this.shift});
  @override State<CashShiftDetailsSheet> createState() => _CashShiftDetailsSheetState();
}
class _CashShiftDetailsSheetState extends State<CashShiftDetailsSheet> {
  CashShiftDetail? detail; String? error; bool loading = true;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async { try { final value = await widget.api.cashShiftDetail(widget.shift.id); if (mounted) setState(() { detail = value; loading = false; }); } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); } }
  @override Widget build(BuildContext context) {
    final d = detail;
    return SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Детали кассовой смены', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)), const SizedBox(height: 5), Text('ID: ${widget.shift.id}', style: const TextStyle(color: Colors.blueGrey)), const SizedBox(height: 18),
      if (loading) const Padding(padding: EdgeInsets.all(45), child: Center(child: CircularProgressIndicator()))
      else if (error != null) ErrorCard(error: error!, onRetry: load)
      else if (d != null) ...[
        Row(children: [Expanded(child: _DetailKpi(title: 'Безналичные', value: money(d.cashless))), const SizedBox(width: 8), Expanded(child: _DetailKpi(title: 'Приходы', value: money(d.payIns))), const SizedBox(width: 8), Expanded(child: _DetailKpi(title: 'Расходы', value: money(d.payOuts)))]),
        const SizedBox(height: 18),
        const Text('Операции', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)), const SizedBox(height: 10),
        if (d.payments.isEmpty) const Card(child: Padding(padding: EdgeInsets.all(20), child: Text('Операций по смене нет')))
        else ...d.payments.map((p) => Card(margin: const EdgeInsets.only(bottom: 8), child: ListTile(leading: const Icon(Icons.payments_outlined), title: Text(p.type.isEmpty ? p.group : p.type), subtitle: p.comment.isEmpty ? Text(p.group) : Text('${p.group} • ${p.comment}'), trailing: Text(money(p.actualSum), style: const TextStyle(fontWeight: FontWeight.w800))))),
      ],
    ]))));
  }
}

class _DetailKpi extends StatelessWidget { final String title, value; const _DetailKpi({required this.title, required this.value}); @override Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontSize: 10, color: Colors.blueGrey)), const SizedBox(height: 5), Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))]))); }

class ErrorCard extends StatelessWidget { final String error; final VoidCallback onRetry; const ErrorCard({super.key, required this.error, required this.onRetry}); @override Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(18), child: Column(children: [const Icon(Icons.cloud_off, size: 42), const SizedBox(height: 10), const Text('Не удалось получить данные', style: TextStyle(fontWeight: FontWeight.w700)), const SizedBox(height: 6), Text(error, textAlign: TextAlign.center, style: const TextStyle(color: Colors.blueGrey)), const SizedBox(height: 14), FilledButton(onPressed: onRetry, child: const Text('Повторить'))]))); }

String formatDate(DateTime d) => '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
String money(double value) => '${value.toStringAsFixed(2).replaceAll('.', ',')} ₼';
