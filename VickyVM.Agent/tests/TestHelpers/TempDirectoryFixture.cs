using System.IO;

namespace VickyVM.Agent.Tests.TestHelpers;

/// <summary>
/// Provides a temporary directory for tests that is automatically cleaned up.
/// </summary>
public class TempDirectoryFixture : IDisposable
{
    public string TempPath { get; }

    public TempDirectoryFixture()
    {
        TempPath = Path.Combine(Path.GetTempPath(), "VickyVM.Agent.Tests", Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(TempPath);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(TempPath))
            {
                Directory.Delete(TempPath, true);
            }
        }
        catch
        {
            // Ignore cleanup errors
        }
    }
}