using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace SmartHoreca.ZKTeco.Connector;

public sealed record AttendanceEvent(
    string SourceId,
    string DeviceKey,
    string ExternalEmployeeId,
    string EventTime,
    string EventType,
    string VerifyMethod,
    string RawJson);

public sealed record QueuedAttendanceEvent(
    long QueueId,
    string SourceId,
    string DeviceKey,
    string ExternalEmployeeId,
    string EventTime,
    string EventType,
    string VerifyMethod,
    string RawJson,
    int AttemptCount);

public sealed record SendResult(bool Success, string Error, int Received = 0, int Invalid = 0);

public static class EventTools
{
    public static string NormalizeDirection(string? value)
    {
        var s = (value ?? "").Trim().ToUpperInvariant();
        return s switch
        {
            "0" or "IN" or "ENTRY" or "CHECKIN" => "IN",
            "1" or "OUT" or "EXIT" or "CHECKOUT" => "OUT",
            _ => "UNKNOWN"
        };
    }

    public static string LocalTimestamp(DateTime localTime, int utcOffsetMinutes)
    {
        var unspecified = DateTime.SpecifyKind(localTime, DateTimeKind.Unspecified);
        return new DateTimeOffset(unspecified, TimeSpan.FromMinutes(utcOffsetMinutes)).ToString("O", CultureInfo.InvariantCulture);
    }

    public static bool TryParseDeviceLocalTime(string value, int utcOffsetMinutes, out string timestamp)
    {
        timestamp = "";
        DateTime local;
        if (!DateTime.TryParseExact(value.Trim(), "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out local) &&
            !DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out local))
            return false;

        timestamp = LocalTimestamp(local, utcOffsetMinutes);
        return true;
    }

    public static string StableSourceId(params string?[] parts)
    {
        var canonical = string.Join("|", parts.Select(x => (x ?? "").Trim()));
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
