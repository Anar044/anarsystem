using Microsoft.Data.Sqlite;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class EventQueue
{
    private readonly string _connectionString;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private volatile bool _initialized;

    public EventQueue(ConnectorConfig config)
    {
        var dbPath = Path.Combine(config.DataDirectory, "connector.db");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString();
    }

    private async Task EnsureInitializedAsync(CancellationToken ct)
    {
        if (_initialized) return;
        await _initLock.WaitAsync(ct);
        try
        {
            if (_initialized) return;
            await using var db = new SqliteConnection(_connectionString);
            await db.OpenAsync(ct);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS attendance_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id TEXT NOT NULL UNIQUE,
                    device_key TEXT NOT NULL,
                    external_employee_id TEXT NOT NULL,
                    event_time TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    verify_method TEXT NOT NULL DEFAULT '',
                    raw_json TEXT NOT NULL DEFAULT '{}',
                    state TEXT NOT NULL DEFAULT 'PENDING',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    sent_at TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_attendance_pending
                    ON attendance_queue(device_key,state,id);
                CREATE INDEX IF NOT EXISTS idx_attendance_sent
                    ON attendance_queue(state,sent_at);
                """;
            await cmd.ExecuteNonQueryAsync(ct);
            _initialized = true;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task<bool> EnqueueAsync(AttendanceEvent item, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT OR IGNORE INTO attendance_queue
                (source_id,device_key,external_employee_id,event_time,event_type,verify_method,raw_json,state,created_at)
            VALUES ($source,$device,$employee,$time,$type,$verify,$raw,'PENDING',$created);
            """;
        cmd.Parameters.AddWithValue("$source", item.SourceId);
        cmd.Parameters.AddWithValue("$device", item.DeviceKey);
        cmd.Parameters.AddWithValue("$employee", item.ExternalEmployeeId);
        cmd.Parameters.AddWithValue("$time", item.EventTime);
        cmd.Parameters.AddWithValue("$type", item.EventType);
        cmd.Parameters.AddWithValue("$verify", item.VerifyMethod);
        cmd.Parameters.AddWithValue("$raw", item.RawJson);
        cmd.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToString("O"));
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<List<QueuedAttendanceEvent>> GetPendingAsync(string deviceKey, int limit, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        var result = new List<QueuedAttendanceEvent>();
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id,source_id,device_key,external_employee_id,event_time,event_type,verify_method,raw_json,attempt_count
            FROM attendance_queue
            WHERE device_key=$device AND state='PENDING'
            ORDER BY id
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$device", deviceKey);
        cmd.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 2000));
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new QueuedAttendanceEvent(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.GetString(6), reader.GetString(7), reader.GetInt32(8)));
        }
        return result;
    }

    public async Task MarkSentAsync(IEnumerable<long> ids, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var tx = await db.BeginTransactionAsync(ct);
        foreach (var id in ids)
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = "UPDATE attendance_queue SET state='SENT',sent_at=$sent,last_error='' WHERE id=$id;";
            cmd.Parameters.AddWithValue("$sent", DateTimeOffset.UtcNow.ToString("O"));
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    public async Task MarkFailureAsync(IEnumerable<long> ids, string error, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var tx = await db.BeginTransactionAsync(ct);
        foreach (var id in ids)
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = "UPDATE attendance_queue SET attempt_count=attempt_count+1,last_error=$error WHERE id=$id;";
            cmd.Parameters.AddWithValue("$error", (error ?? "")[..Math.Min((error ?? "").Length, 1000)]);
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    public async Task<long> CountPendingAsync(CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM attendance_queue WHERE state='PENDING';";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
    }

    public async Task PruneSentAsync(int retentionDays, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        var cutoff = DateTimeOffset.UtcNow.AddDays(-Math.Clamp(retentionDays, 1, 3650)).ToString("O");
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync(ct);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "DELETE FROM attendance_queue WHERE state='SENT' AND sent_at<>'' AND sent_at<$cutoff;";
        cmd.Parameters.AddWithValue("$cutoff", cutoff);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
