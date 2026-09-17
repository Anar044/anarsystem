# SmartHoreca ZKTeco Connector

Standalone Windows connector for SmartHoreca attendance devices.

## Architecture

`ZKTeco -> restaurant LAN -> Windows Service + SQLite queue -> Internet -> SmartHoreca`

The Windows Service is independent from the desktop UI. `SmartHoreca.ZKTeco.Tray.exe` is only a monitor/control panel and can be closed without stopping attendance collection.

An attendance event is first committed to the local SQLite queue. Only after SmartHoreca acknowledges the batch is the local row marked `SENT`. Sent rows are retained locally (90 days by default) for audit/recovery.

## Tray interface

The release contains two executables:

- `SmartHoreca.ZKTeco.Connector.exe` - background connector / Windows Service
- `SmartHoreca.ZKTeco.Tray.exe` - tray icon and status window

The tray window shows:

- Windows Service status
- SmartHoreca Cloud status
- number of locally queued events
- each ZKTeco terminal: model, adapter, IP/port, online/offline, last contact and last attendance event
- connector version and latest cloud error

It also provides buttons to open `connector.json`, `connector.log`, the data directory, and restart the Windows Service.

`install-service.ps1` adds the tray app to the current Windows user's startup automatically.

## Runtime files

Default folder:

`C:\ProgramData\SmartHoreca\ZKTecoConnector`

Files:

- `connector.json` - local configuration and device tokens
- `connector.db` - durable SQLite event queue/history
- `runtime-status.json` - non-secret live status used by the tray UI
- `connector.log` / `connector.log.1` - local diagnostic log

## Device modes

### `TA_PUSH`

Recommended where firmware supports it (SenseFace 2A / SenseFace 3A and compatible F18 firmware). Configure the terminal's ADMS/TA Push server to the LAN IP of the restaurant PC and `TaPushListenPort` (default `8088`). Events continue reaching the connector without Internet access.

### `ZKEMKEEPER`

Fallback for F18/standalone firmware exposing the ZKTeco Standalone SDK. The connector connects to the terminal by local IP/port (commonly `4370`) using the vendor `zkemkeeper` COM SDK. Build artifacts are produced for x64 and x86 because vendor SDK bitness can differ.

## Install as Windows Service

Open PowerShell as Administrator in the extracted release folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-service.ps1 -ExePath .\SmartHoreca.ZKTeco.Connector.exe
```

If no config exists, the installer creates `%ProgramData%\SmartHoreca\ZKTecoConnector\connector.json`. Edit it, then start the service:

```powershell
sc.exe start SmartHorecaZKTecoConnector
```

The installer also reserves the TA Push URL, opens the selected port only to the local subnet on Private/Domain firewall profiles, registers the tray app in user startup and launches it.

## Manual diagnostic run

You can still launch `SmartHoreca.ZKTeco.Connector.exe` directly. In that mode the console window shows logs. The tray app is separate and can be launched manually at the same time.

## Delivery guarantees

- SQLite WAL + `synchronous=FULL`
- queue-before-cloud-send
- cloud ACK before `SENT`
- stable `sourceId` for idempotent retry
- server-side dedup remains active
- exponential cloud retry when Internet/server is unavailable
- local sent-history retention
- raw device record retained locally and forwarded inside cloud audit data
- live runtime status written every 2 seconds without exposing device tokens

## Production check

Before deploying a model/firmware combination, verify the actual TA Push ATTLOG field order/status values, device time/UTC offset, IN/OUT configuration and (for ZKEMKEEPER) the vendor COM SDK bitness.
