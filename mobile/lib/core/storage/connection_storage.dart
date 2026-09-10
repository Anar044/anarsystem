import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class IikoConnection {
  final String ip;
  final String port;
  final String login;
  final String password;

  const IikoConnection({
    required this.ip,
    required this.port,
    required this.login,
    required this.password,
  });
}

class ConnectionStorage {
  static const _storage = FlutterSecureStorage();
  static const _ip = 'iiko_ip';
  static const _port = 'iiko_port';
  static const _login = 'iiko_login';
  static const _password = 'iiko_password';

  Future<IikoConnection?> read() async {
    final ip = await _storage.read(key: _ip);
    final port = await _storage.read(key: _port);
    final login = await _storage.read(key: _login);
    final password = await _storage.read(key: _password);
    if ([ip, port, login, password].any((v) => v == null || v!.trim().isEmpty)) return null;
    return IikoConnection(ip: ip!, port: port!, login: login!, password: password!);
  }

  Future<void> save(IikoConnection value) async {
    await _storage.write(key: _ip, value: value.ip.trim());
    await _storage.write(key: _port, value: value.port.trim());
    await _storage.write(key: _login, value: value.login.trim());
    await _storage.write(key: _password, value: value.password);
  }

  Future<void> clear() async {
    await _storage.deleteAll();
  }
}
