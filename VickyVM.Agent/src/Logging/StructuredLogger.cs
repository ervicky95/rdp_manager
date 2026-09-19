using System;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using VickyVM.Agent.Configuration;

namespace VickyVM.Agent.Logging;

/// <summary>
/// Structured text logger that writes JSON-formatted log lines to rolling local files.
/// Designed for minimal CPU/memory overhead and safe operation as a Windows Service.
/// One line per entry; rotation by day and by size; retention by count and age.
/// </summary>
public sealed class StructuredLogger : ILogger, IDisposable
{
    private readonly string _categoryName;
    private readonly StructuredLoggerOptions _options;
    private readonly LogLevel _minLogLevel;
    private readonly object _sync = new();
    private readonly JsonSerializerOptions _jsonOptions;
    private string? _currentLogFile;
    private DateTime _currentLogDate;
    private long _currentFileSize;
    private bool _disposed;

    public StructuredLogger(
        string categoryName,
        IOptions<StructuredLoggerOptions> options)
    {
        _categoryName = categoryName;
        _options = options.Value;
        _minLogLevel = ParseLogLevel(_options.MinLogLevel);
        _currentLogDate = DateTime.UtcNow.Date;
        _jsonOptions = new JsonSerializerOptions { WriteIndented = false };

        EnsureLogDirectory();
        RotateLogFile();
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel >= _minLogLevel && !_disposed;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(logLevel) || _disposed)
        {
            return;
        }

        var message = formatter(state, exception);
        var entry = new StructuredLogEntry
        {
            Timestamp = DateTime.UtcNow,
            Level = logLevel.ToString(),
            Category = _categoryName,
            EventId = eventId.Id,
            Message = message,
            Exception = exception?.ToString()
        };

        WriteToFile(JsonSerializer.Serialize(entry, _jsonOptions));
    }

    private void WriteToFile(string line)
    {
        lock (_sync)
        {
            if (_disposed) return;

            RollLogFileIfNeeded();

            try
            {
                var bytes = Encoding.UTF8.GetBytes(line + Environment.NewLine);
                using (var stream = new FileStream(_currentLogFile!, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
                _currentFileSize += bytes.Length;

                if (_currentFileSize >= _options.FileSizeLimitBytes)
                {
                    RotateLogFile();
                }
            }
            catch (Exception ex)
            {
                // Never let logging failures crash the service.
                Console.Error.WriteLine($"[LOGGER ERROR] Failed to write log: {ex.Message}");
            }
        }
    }

    private void EnsureLogDirectory()
    {
        try
        {
            var directory = Path.GetDirectoryName(_options.Path);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LOGGER ERROR] Failed to create log directory: {ex.Message}");
        }
    }

    private void RollLogFileIfNeeded()
    {
        var today = DateTime.UtcNow.Date;
        if (_currentLogFile == null || today != _currentLogDate)
        {
            _currentLogDate = today;
            RotateLogFile();
        }
    }

    private void RotateLogFile()
    {
        // Date-stamp only the file name, never the directory path.
        var directory = Path.GetDirectoryName(_options.Path) ?? ".";
        var fileName = Path.GetFileName(_options.Path);
        var stem = fileName.EndsWith(".log", StringComparison.OrdinalIgnoreCase)
            ? fileName[..^4]
            : fileName;

        _currentLogFile = Path.Combine(directory, $"{stem}{_currentLogDate:yyyy-MM-dd}.log");

        try
        {
            _currentFileSize = File.Exists(_currentLogFile) ? new FileInfo(_currentLogFile).Length : 0;
        }
        catch
        {
            _currentFileSize = 0;
        }

        CleanupOldLogFiles();
    }

    private void CleanupOldLogFiles()
    {
        try
        {
            var directory = Path.GetDirectoryName(_options.Path) ?? ".";
            var fileName = Path.GetFileName(_options.Path);
            var stem = fileName.EndsWith(".log", StringComparison.OrdinalIgnoreCase)
                ? fileName[..^4]
                : fileName;
            var pattern = $"{stem}*.log";

            var files = Directory.GetFiles(directory, pattern)
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .ToList();

            var cutoff = DateTime.UtcNow.AddDays(-_options.MaxLogAgeDays);
            foreach (var file in files)
            {
                if (file.LastWriteTimeUtc < cutoff)
                {
                    TryDelete(file);
                }
            }

            files = Directory.GetFiles(directory, pattern)
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .ToList();

            while (files.Count > _options.RetainedFileCountLimit)
            {
                var oldest = files[^1];
                if (TryDelete(oldest))
                {
                    files.RemoveAt(files.Count - 1);
                }
                else
                {
                    files.RemoveAt(files.Count - 1);
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LOGGER ERROR] Failed to cleanup old logs: {ex.Message}");
        }
    }

    private static bool TryDelete(FileInfo file)
    {
        try
        {
            file.Delete();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static LogLevel ParseLogLevel(string level) =>
        Enum.TryParse<LogLevel>(level, true, out var parsed) ? parsed : LogLevel.Information;

    public void Dispose()
    {
        _disposed = true;
    }
}

/// <summary>
/// Options for the structured logger. Keys match the "Logging:File" JSON section.
/// </summary>
public sealed class StructuredLoggerOptions
{
    public string Path { get; init; } = @"C:\ProgramData\VickyVM.Agent\Logs\agent-.log";
    public string MinLogLevel { get; init; } = "Information";
    public string RollingInterval { get; init; } = "Day";
    public int RetainedFileCountLimit { get; init; } = 30;
    public long FileSizeLimitBytes { get; init; } = 104857600;
    public int MaxLogAgeDays { get; init; } = 30;
}

/// <summary>
/// Structured log entry for JSON serialization.
/// </summary>
public sealed record StructuredLogEntry
{
    public DateTime Timestamp { get; init; }
    public string Level { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public int EventId { get; init; }
    public string Message { get; init; } = string.Empty;
    public string? Exception { get; init; }
}