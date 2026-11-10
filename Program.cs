using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;

// STL Knihovna – tenký lokální server: prochází složku s modely, vrací soubory,
// ukládá metadata a náhledy a otevírá soubory ve Windows. Veškerá logika
// (seskupování projektů, filtry, náhledy, 3D prohlížeč) je v wwwroot/js.

var appDir = FindAppDir();
var configPath = Path.Combine(appDir, "config.json");
var config = File.Exists(configPath)
    ? JsonNode.Parse(File.ReadAllText(configPath)) as JsonObject ?? new JsonObject()
    : new JsonObject();

var rootArg = args.FirstOrDefault(a => !a.StartsWith("--"));
var rootDir = Path.GetFullPath(rootArg ?? config["root"]?.GetValue<string>() ?? Directory.GetCurrentDirectory());
if (!Directory.Exists(rootDir))
{
    Console.Error.WriteLine($"Složka s modely neexistuje: {rootDir}");
    Console.Error.WriteLine($"Uprav \"root\" v {configPath} nebo ji předej jako argument.");
    return 1;
}
var port = config["port"]?.GetValue<int>() ?? 5173;
var slicer = config["slicer"]?.GetValue<string>() ?? "";
var openBrowser = config["openBrowser"]?.GetValue<bool>() ?? true;

// Data (poznámky, štítky, náhledy) jsou uložená zvlášť pro každou složku s modely: data/roots/<hash>/
var dataDir = Path.Combine(appDir, "data");
string metaPath = "";
string thumbDir = "";

void ActivateData(string root, bool migrateLegacy)
{
    var norm = root.TrimEnd('\\', '/').ToLowerInvariant();
    var key = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(norm)))
        .Substring(0, 10).ToLowerInvariant();
    var d = Path.Combine(dataDir, "roots", key);
    Directory.CreateDirectory(Path.Combine(d, "thumbs"));
    File.WriteAllText(Path.Combine(d, "root.txt"), root);
    metaPath = Path.Combine(d, "meta.json");
    thumbDir = Path.Combine(d, "thumbs");
    if (!migrateLegacy) return;
    // starší verze ukládala data přímo do data/ – přesuneme je ke stávající složce
    var legacyMeta = Path.Combine(dataDir, "meta.json");
    var legacyThumbs = Path.Combine(dataDir, "thumbs");
    if (File.Exists(legacyMeta) && !File.Exists(metaPath)) File.Move(legacyMeta, metaPath);
    if (Directory.Exists(legacyThumbs))
    {
        foreach (var f in Directory.GetFiles(legacyThumbs, "*.png"))
        {
            var dest = Path.Combine(thumbDir, Path.GetFileName(f));
            if (!File.Exists(dest)) File.Move(f, dest);
        }
    }
}

bool SaveConfig()
{
    try
    {
        var opts = new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        File.WriteAllText(configPath, config.ToJsonString(opts));
        return true;
    }
    catch (Exception) { return false; }
}

ActivateData(rootDir, true);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    ContentRootPath = appDir,
    WebRootPath = "wwwroot"
});
builder.Logging.SetMinimumLevel(LogLevel.Warning);
var app = builder.Build();
app.Urls.Add($"http://127.0.0.1:{port}");

var contentTypes = new FileExtensionContentTypeProvider();
var openAllowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "stl", "3mf", "step", "stp", "obj", "f3d", "f3z", "fcstd", "skp", "scad", "amf", "ply", "iges", "igs",
    "gcode", "svg", "dxf", "png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf", "txt", "md"
};
var thumbKeyRx = new Regex("^[a-z0-9-]{4,80}$", RegexOptions.Compiled);

// Cesta relativní ke kořeni → absolutní, ale jen uvnitř kořene (ochrana proti ../).
string? Resolve(string? rel)
{
    if (string.IsNullOrWhiteSpace(rel)) return null;
    var full = Path.GetFullPath(Path.Combine(rootDir, rel.Replace('/', Path.DirectorySeparatorChar)));
    var prefix = rootDir.EndsWith(Path.DirectorySeparatorChar) ? rootDir : rootDir + Path.DirectorySeparatorChar;
    return full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? full : null;
}

// Po smazání souboru uklidí prázdné složky směrem ke kořeni (kořen samotný nikdy nemaže).
void RemoveEmptyParents(string? dir)
{
    var rootTrim = rootDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    while (!string.IsNullOrEmpty(dir))
    {
        var cur = dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (cur.Length <= rootTrim.Length || !cur.StartsWith(rootTrim, StringComparison.OrdinalIgnoreCase)) break;
        if (Directory.EnumerateFileSystemEntries(cur).Any()) break;
        Directory.Delete(cur);
        dir = Path.GetDirectoryName(cur);
    }
}

// Zápisy musí mít vlastní hlavičku – cizí web na localhost tak nic nezapíše ani nespustí.
bool HasGuard(HttpContext ctx) => ctx.Request.Headers.ContainsKey("X-STL");

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache"
});

var asmName = System.Reflection.Assembly.GetExecutingAssembly();
var ver = asmName.GetName().Version;
var appVersion = ver == null ? "dev" : $"{ver.Major}.{ver.Minor}.{ver.Build}";
var appBuilt = asmName.GetCustomAttributes(typeof(System.Reflection.AssemblyMetadataAttribute), false)
    .Cast<System.Reflection.AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "BuildDate")?.Value ?? "";

app.MapGet("/api/library", () =>
{
    var files = new List<object>();
    var opt = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, MaxRecursionDepth = 12 };
    foreach (var path in Directory.EnumerateFiles(rootDir, "*", opt))
    {
        try
        {
            var fi = new FileInfo(path);
            var rel = Path.GetRelativePath(rootDir, path).Replace('\\', '/');
            var m = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeMilliseconds();
            files.Add(new { p = rel, s = fi.Length, m });
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
    return Results.Json(new { root = rootDir, config, files, version = appVersion, built = appBuilt });
});

app.MapGet("/api/file", (string path) =>
{
    var full = Resolve(path);
    if (full == null || !File.Exists(full)) return Results.NotFound();
    if (!contentTypes.TryGetContentType(full, out var ct)) ct = "application/octet-stream";
    return Results.File(full, ct, enableRangeProcessing: true);
});

app.MapPost("/api/open", async (HttpContext ctx) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    var req = await ctx.Request.ReadFromJsonAsync<OpenRequest>();
    var full = Resolve(req?.Path);
    if (req == null || full == null || (!File.Exists(full) && !Directory.Exists(full)))
        return Results.NotFound(new { error = "Soubor nenalezen" });
    if (!OperatingSystem.IsWindows())
        return Results.Json(new { error = "Otevírání souborů funguje jen ve Windows" }, statusCode: 501);

    try
    {
        if (req.Mode == "reveal")
        {
            var args2 = Directory.Exists(full) ? $"\"{full}\"" : $"/select,\"{full}\"";
            Process.Start(new ProcessStartInfo("explorer.exe", args2) { UseShellExecute = true });
        }
        else
        {
            var ext = Path.GetExtension(full).TrimStart('.');
            if (!openAllowed.Contains(ext))
                return Results.Json(new { error = "Tento typ souboru nelze otevřít" }, statusCode: 400);
            if (!string.IsNullOrWhiteSpace(slicer) && File.Exists(slicer))
            {
                var psi = new ProcessStartInfo(slicer) { UseShellExecute = false };
                psi.ArgumentList.Add(full);
                Process.Start(psi);
            }
            else
            {
                Process.Start(new ProcessStartInfo(full) { UseShellExecute = true });
            }
        }
        return Results.Ok(new { ok = true });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

// Procházení složek pro výběr kořenové složky (jen lokálně, vyžaduje hlavičku X-STL).
app.MapGet("/api/browse", (HttpContext ctx, string? path) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    try
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            var drives = OperatingSystem.IsWindows()
                ? DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => new { name = d.Name, path = d.Name }).ToArray()
                : new[] { new { name = "/", path = "/" } };
            return Results.Json(new { path = "", parent = (string?)null, dirs = drives });
        }
        var full = Path.GetFullPath(path.Trim().Trim('"'));
        if (!Directory.Exists(full)) return Results.Json(new { error = "Složka neexistuje: " + full }, statusCode: 404);
        var di = new DirectoryInfo(full);
        var dirs = di.EnumerateDirectories()
            .Where(d => (d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) == 0)
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => new { name = d.Name, path = d.FullName })
            .ToArray();
        return Results.Json(new { path = full, parent = di.Parent?.FullName ?? "", dirs });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 400);
    }
});

// Změna kořenové složky s modely (uloží se do config.json).
app.MapPost("/api/root", async (HttpContext ctx) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    var req = await ctx.Request.ReadFromJsonAsync<RootRequest>();
    var input = req?.Path?.Trim().Trim('"');
    if (string.IsNullOrWhiteSpace(input)) return Results.BadRequest(new { error = "Zadej cestu ke složce" });
    string full;
    try { full = Path.GetFullPath(input); }
    catch (Exception) { return Results.BadRequest(new { error = "Neplatná cesta" }); }
    if (!Directory.Exists(full)) return Results.BadRequest(new { error = "Složka neexistuje: " + full });

    var recent = new List<string> { full };
    if (config["recentRoots"] is JsonArray old)
    {
        foreach (var n in old)
        {
            var s = n?.GetValue<string>();
            if (!string.IsNullOrEmpty(s) && !string.Equals(s, full, StringComparison.OrdinalIgnoreCase)) recent.Add(s);
        }
    }
    var arr = new JsonArray();
    foreach (var r in recent.Take(8)) arr.Add(r);

    rootDir = full;
    ActivateData(full, false);
    config["root"] = full;
    config["recentRoots"] = arr;
    var saved = SaveConfig();
    return Results.Ok(new { root = rootDir, saved });
});

// Trvalé smazání souborů z disku (bez koše). Jen soubory uvnitř kořenové složky.
app.MapPost("/api/delete", async (HttpContext ctx) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    var req = await ctx.Request.ReadFromJsonAsync<DeleteRequest>();
    if (req?.Paths == null || req.Paths.Length == 0 || req.Paths.Length > 2000)
        return Results.BadRequest(new { error = "Neplatný požadavek" });

    var deleted = new List<string>();
    var failed = new List<object>();
    foreach (var rel in req.Paths)
    {
        var full = Resolve(rel);
        if (full == null || !File.Exists(full))
        {
            failed.Add(new { path = rel, error = "Soubor nenalezen" });
            continue;
        }
        try
        {
            var attrs = File.GetAttributes(full);
            if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(full, attrs & ~FileAttributes.ReadOnly);
            File.Delete(full);
            deleted.Add(rel);
            RemoveEmptyParents(Path.GetDirectoryName(full));
        }
        catch (Exception ex)
        {
            failed.Add(new { path = rel, error = ex.Message });
        }
    }
    return Results.Json(new { deleted, failed });
});

// Přejmenování souboru na disku (jen název, zůstává ve stejné složce).
app.MapPost("/api/rename", async (HttpContext ctx) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    var req = await ctx.Request.ReadFromJsonAsync<RenameRequest>();
    var name = (req?.Name ?? "").Trim();
    var full = Resolve(req?.Path);
    if (full == null || !File.Exists(full)) return Results.BadRequest(new { error = "Soubor nenalezen" });
    if (name.Length == 0 || name.Length > 200 || name == "." || name == ".." || name.EndsWith('.')
        || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        return Results.BadRequest(new { error = "Neplatný název souboru" });
    var target = Path.Combine(Path.GetDirectoryName(full)!, name);
    if (Resolve(Path.GetRelativePath(rootDir, target)) == null) return Results.BadRequest(new { error = "Neplatný název souboru" });
    if (!string.Equals(full, target, StringComparison.OrdinalIgnoreCase) && (File.Exists(target) || Directory.Exists(target)))
        return Results.Conflict(new { error = "Soubor s tímto názvem už existuje" });
    try { File.Move(full, target); }
    catch (Exception ex) { return Results.BadRequest(new { error = ex.Message }); }
    return Results.Json(new { path = Path.GetRelativePath(rootDir, target).Replace('\\', '/') });
});

app.MapGet("/api/meta", () =>
    Results.Content(File.Exists(metaPath) ? File.ReadAllText(metaPath) : "{}", "application/json"));

app.MapPut("/api/meta", async (HttpContext ctx) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    using var reader = new StreamReader(ctx.Request.Body);
    var text = await reader.ReadToEndAsync();
    try { JsonDocument.Parse(text).Dispose(); }
    catch (JsonException) { return Results.BadRequest(new { error = "Neplatný JSON" }); }
    var tmp = metaPath + ".tmp";
    await File.WriteAllTextAsync(tmp, text);
    File.Move(tmp, metaPath, overwrite: true);
    return Results.NoContent();
});

app.MapGet("/api/thumbs", () =>
    Results.Json(Directory.GetFiles(thumbDir, "*.png").Select(f => Path.GetFileNameWithoutExtension(f)).ToArray()));

app.MapGet("/api/thumb/{key}", (string key) =>
{
    if (!thumbKeyRx.IsMatch(key)) return Results.NotFound();
    var f = Path.Combine(thumbDir, key + ".png");
    if (!File.Exists(f)) return Results.NotFound();
    return Results.File(f, "image/png");
});

app.MapPut("/api/thumb/{key}", async (HttpContext ctx, string key) =>
{
    if (!HasGuard(ctx)) return Results.StatusCode(403);
    if (!thumbKeyRx.IsMatch(key)) return Results.BadRequest();
    using var ms = new MemoryStream();
    await ctx.Request.Body.CopyToAsync(ms);
    if (ms.Length == 0 || ms.Length > 2_000_000) return Results.BadRequest();
    await File.WriteAllBytesAsync(Path.Combine(thumbDir, key + ".png"), ms.ToArray());
    return Results.NoContent();
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = $"http://127.0.0.1:{port}";
    Console.WriteLine($"STL Knihovna v{appVersion} (sestavení {appBuilt}) běží na {url}");
    Console.WriteLine($"Složka s modely: {rootDir}");
    Console.WriteLine("Ukončíš ji zavřením tohoto okna (nebo Ctrl+C).");
    if (openBrowser && OperatingSystem.IsWindows())
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
});

app.Run();
return 0;

static string FindAppDir()
{
    foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
    {
        var d = new DirectoryInfo(start);
        while (d != null)
        {
            if (File.Exists(Path.Combine(d.FullName, "config.json")) && Directory.Exists(Path.Combine(d.FullName, "wwwroot")))
                return d.FullName;
            d = d.Parent;
        }
    }
    return Directory.GetCurrentDirectory();
}

record OpenRequest(string? Path, string? Mode);
record DeleteRequest(string[]? Paths);
record RootRequest(string? Path);
record RenameRequest(string? Path, string? Name);
