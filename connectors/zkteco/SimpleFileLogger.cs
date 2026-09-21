using Microsoft.Extensions.Logging;

namespace SmartHoreca.ZKTeco.Connector;

public sealed class SimpleFileLoggerProvider : ILoggerProvider
{
    private readonly object _gate = new();
    private readonly string _path;
    private readonly long _maxBytes;

    public SimpleFileLoggerProvider(string path, long maxBytes = 5 * 1024 * 1024)
    {
        _path = path;
        _maxBytes = maxBytes;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public ILogger CreateLogger(string categoryName) => new SimpleFileLogger(this, categoryName);
    public void Dispose() { }

    private void Write(LogLevel level, string category, string message, Exception? exception)
    {
        lock (_gate)
        {
            try
            {
                if (File.Exists(_path) && new FileInfo(_path).Length >= _maxBytes)
                {
                    var previous = _path + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(_path, previous);
                }

                var line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [{level}] {category}: {message}";
                if (exception is not null) line += Environment.NewLine + exception;
                File.AppendAllText(_path, line + Environment.NewLine);
            }
            catch { }
        }
    }

    private sealed class SimpleFileLogger : ILogger
    {
        private readonly SimpleFileLoggerProvider _provider;
        private readonly string _category;

        public SimpleFileLogger(SimpleFileLoggerProvider provider, string category)
        {
            _provider = provider;
            _category = category;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            _provider.Write(logLevel, _category, formatter(state, exception), exception);
        }
    }
}
