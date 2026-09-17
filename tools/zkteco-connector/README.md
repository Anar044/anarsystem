# SmartHoreca ZKTeco Connector

Local connector for ZKTeco attendance terminals such as **F18**, **SenseFace 2A** and **SenseFace 3A**.

The first implementation supports the ZKTeco Push/ADMS attendance flow. It receives terminal requests on `/iclock/*`, normalizes `ATTLOG` records and securely forwards them to SmartHoreca `/api/hr/device-ingest` using the device token created in **Employees → Time attendance / Face ID**.

## Architecture

```text
ZKTeco terminal
   │ LAN / Push (ADMS)
   ▼
SmartHoreca ZKTeco Connector
   │ local durable queue
   │ HTTPS + device token
   ▼
SmartHoreca /api/hr/device-ingest
   ▼
Raw attendance events → employee mapping → timesheet → payroll
```

## Requirements

- Windows 10/11 or Linux
- Node.js 20+
- Terminal and connector PC reachable on the same LAN for Push mode
- SmartHoreca device token

No npm packages are required.

## Install

```powershell
cd tools\zkteco-connector
Copy-Item config.example.json config.json
notepad config.json
node src\index.js
```

Default listen address:

```text
0.0.0.0:8088
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8088/health
```

## SmartHoreca device token

1. Open SmartHoreca.
2. Go to **Employees → Time attendance / Face ID**.
3. Add a ZKTeco device.
4. Create a connector key.
5. Put the key into `config.json` as `deviceToken`.
6. Put the physical terminal Serial Number into the `devices` object key.

Example:

```json
"devices": {
  "CQZX123456789": {
    "enabled": true,
    "name": "Main entrance",
    "model": "SenseFace 3A",
    "deviceToken": "shd_..."
  }
}
```

`config.json` is excluded from Git because it contains a secret token.

## Terminal Push / ADMS settings

Exact menu labels depend on firmware. On supported firmware find the menu related to **ADMS / Cloud Server / Server Settings / Push** and configure:

- Server address: LAN IP of the PC running this connector
- Server port: `8088` by default
- ADMS / Cloud Server: enabled

For example, if the connector PC is `192.168.1.50`:

```text
Server Address: 192.168.1.50
Server Port:    8088
```

Do not configure the terminal to talk directly to Cloudflare. The local connector is intentional: it provides LAN compatibility, offline buffering and one adapter for different ZKTeco firmware families.

## Supported Push routes

The connector currently answers:

```text
GET/POST /iclock/cdata
GET      /iclock/getrequest
POST     /iclock/devicecmd
GET      /health
```

`ATTLOG` packets are parsed and normalized to SmartHoreca events.

## Attendance status mapping

Common ZKTeco attendance states are normalized as follows:

```text
0 → IN
1 → OUT
2 → OUT   (break out)
3 → IN    (break in)
4 → IN    (overtime in)
5 → OUT   (overtime out)
other → UNKNOWN
```

The raw status and raw terminal line are also sent to SmartHoreca so firmware-specific behavior can be diagnosed later without losing the original data.

## Offline behavior

Every accepted attendance record is first appended to:

```text
data/pending-events.jsonl
```

Only after SmartHoreca confirms the batch is the record removed from the local queue. If internet is unavailable, the connector keeps retrying automatically.

## Simulation before a real terminal arrives

Set this in `config.json`:

```json
"simulation": {
  "enabled": true
}
```

Then send a test event:

```powershell
$body = @{
  serial = "YOUR_DEVICE_SERIAL"
  employeeId = "17"
  type = "IN"
  verifyMethod = "FACE"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8088/simulate `
  -ContentType "application/json" `
  -Body $body
```

The event should appear in SmartHoreca **Time attendance / Face ID**.

## F18 note

The connector starts with Push/ADMS support because that gives us a common path for SenseFace 2A/3A and compatible F18 firmware. Some F18 firmware may require a standalone TCP/SDK adapter instead. That adapter will live behind the same normalizer and SmartHoreca ingest endpoint, so the rest of the system will not need to change.

## Security

- Each SmartHoreca device has a separate random device token.
- SmartHoreca stores only the SHA-256 hash of the token.
- The connector sends the token only over HTTPS to SmartHoreca.
- Never commit `config.json`.
- The ZKTeco terminal itself never receives SmartHoreca credentials.
