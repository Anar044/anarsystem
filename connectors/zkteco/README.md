# SmartHoreca ZKTeco Connector

Standalone Windows connector for SmartHoreca attendance devices.

## Why it exists

The connector keeps the restaurant operational when the Internet is down:

`ZKTeco -> restaurant LAN -> local connector + SQLite queue -> Internet -> SmartHoreca`

An attendance event is first committed to the local SQLite queue. Only after SmartHoreca acknowledges the batch is the local row marked `SENT`. Sent rows are retained locally (90 days by default) for audit/recovery.

The cloud endpoint is the existing `/api/hr/device-ingest`. Each physical/logical SmartHoreca device keeps its own device token, so one connector PC can safely serve multiple terminals.

## Device modes

### `TA_PUSH` (recommended where firmware supports it)

Use for SenseFace 2A / SenseFace 3A and for an F18 running TA Push firmware.

Configure the terminal's ADMS/TA Push server to the **LAN IP of the restaurant PC** and `TaPushListenPort` (default `8088`). The terminal pushes ATTLOG records to the connector without requiring Internet access.

The current receiver implements the common TA Push attendance endpoints (`/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd`) and persists the raw line. Exact payload/status details must still be verified against the firmware delivered with the real terminal before production rollout.

For local hardening, set each TA Push device's `IpAddress`; requests with the correct serial number arriving from a different LAN IP are rejected.

### `ZKEMKEEPER` (F18 standalone firmware fallback)

Use when the device exposes the ZKTeco Standalone SDK interface. The connector opens `IP:port` (normally port `4370`) through the vendor `zkemkeeper` COM SDK and reads attendance logs.

The vendor SDK must be installed/registered on the restaurant PC. Build artifacts are produced for both x64 and x86 because the COM SDK bitness can differ between installations.

## First configuration

1. Run the EXE once with `--init` (as Administrator if needed).
2. Edit `%ProgramData%\SmartHoreca\ZKTecoConnector\connector.json`.
3. Set `Server.BaseUrl` to the SmartHoreca site.
4. Create/rotate the device token in **Employees -> Time attendance / Face ID** and put it in the matching device entry.
5. For TA Push, set the terminal's server address to the restaurant PC LAN IP and port `8088`.
6. For ZKEMKEEPER, set terminal IP/port and install the matching ZKTeco Standalone SDK.

Do **not** commit real device tokens to Git. The repository contains only an example configuration.

## Local data

Default folder:

`C:\ProgramData\SmartHoreca\ZKTecoConnector`

Files:

- `connector.json` - local configuration and device tokens
- `connector.db` - durable SQLite event queue/history

## Build

```powershell
dotnet publish .\SmartHoreca.ZKTeco.Connector.csproj -c Release -r win-x64 --self-contained true -o .\publish\win-x64
```

For a 32-bit vendor COM SDK:

```powershell
dotnet publish .\SmartHoreca.ZKTeco.Connector.csproj -c Release -r win-x86 --self-contained true -o .\publish\win-x86
```

GitHub Actions also produces both artifacts automatically.

## Windows Service

Use `scripts/install-service.ps1` from an elevated PowerShell. It creates the service and reserves the local TA Push HTTP URL for LocalSystem. After editing the generated configuration, start it with `sc.exe start SmartHorecaZKTecoConnector`.

For initial diagnostics you can also run the EXE directly in a console with:

```powershell
.\SmartHoreca.ZKTeco.Connector.exe --config "C:\ProgramData\SmartHoreca\ZKTecoConnector\connector.json"
```

## Delivery guarantees

- SQLite WAL + `synchronous=FULL`
- queue-before-cloud-send
- cloud ACK before `SENT`
- stable `sourceId` for idempotent retry
- server-side dedup remains active through `(user_id, device_id, source_uid)`
- exponential cloud retry when the Internet/server is unavailable
- local sent-history retention
- raw device record retained locally and forwarded inside the cloud audit payload

## Current production-check items

Before deploying a model/firmware combination, verify:

1. actual TA Push ATTLOG field order and status values;
2. device time / UTC offset;
3. IN/OUT status configuration;
4. zkemkeeper bitness for standalone F18;
5. firewall rule allowing only the restaurant LAN to the configured TA Push port.

The connector deliberately keeps raw device payloads so firmware-specific mappings can be adjusted without losing the original attendance evidence.
