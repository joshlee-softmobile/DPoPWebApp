using CrossCutting.JSON;
using CrossCutting.Logger;
using JoshAuthorization;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.FileProviders;
using NeoSmart.Caching.Sqlite;
using NLog.Web;
using SQLitePCL;
using WebApp.Formatters;
using WebApp.Middlewares;
using WebApp.ServiceCollection;
using WebApp.Swagger;
using ZiggyCreatures.Caching.Fusion;
using ZiggyCreatures.Caching.Fusion.Serialization.SystemTextJson;

var builder = WebApplication.CreateBuilder(args);

// Load version.info written by MSBuild target
var versionInfo = "unknown";
try
{
    var path = Path.Combine(AppContext.BaseDirectory, "version.info");
    if (File.Exists(path))
    {
        versionInfo = File.ReadAllText(path).Trim();
    }
}
catch (Exception ex)
{
    versionInfo = $"error: {ex.Message}";
}
// Make it available via configuration as well singleton
builder.Configuration["VersionInfo"] = versionInfo;

// CorsPolicy
var corsOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? [];
var allowLocalhost = builder.Configuration.GetValue<bool>("Cors:AllowLocalhost");
Console.WriteLine($"Cors:AllowedOrigins: {string.Join(",", corsOrigins)}, AllowLocalhost: {allowLocalhost}");
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsPolicy", policy =>
    {
        policy.AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              .SetPreflightMaxAge(TimeSpan.FromMinutes(10));

        policy.SetIsOriginAllowed(origin =>
        {
            // 1. Allow localhost/127.0.0.1 if explicitly enabled
            if (allowLocalhost)
            {
                try
                {
                    var uri = new Uri(origin);
                    var host = uri.Host;
                    if (host is "localhost" or "127.0.0.1")
                    {
                        return true;
                    }
                }
                catch
                {
                    // Invalid origin format
                }
            }

            // 2. Match against configured AllowedOrigins (supports wildcard * in urls)
            foreach (var allowed in corsOrigins)
            {
                if (allowed == "*")
                {
                    return true;
                }

                if (allowed.Contains("*"))
                {
                    // Escape pattern and convert * to regex .*
                    var pattern = "^" + System.Text.RegularExpressions.Regex.Escape(allowed)
                        .Replace("\\*", ".*") + "$";
                    if (System.Text.RegularExpressions.Regex.IsMatch(origin, pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    {
                        return true;
                    }
                }
                else if (string.Equals(allowed, origin, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        });
    });
});

// Initialise JwtAuth Environment Variables
var jwtAuthEnv = builder.Configuration["JWT_AUTH_ENVIRONMENT"];
builder.Services.Configure<JwtAuthEnvironmentOption>( 
    builder.Configuration.GetSection($"JwtAuthEnvironment:{jwtAuthEnv}")
);

// Register SQLite-based IDistributedCache
builder.Services.AddSqliteCache(options => {
    options.CachePath = "fusioncache.db"; // This sets the path correctly
    // Deletes expired items from the .db file every 60 minutes
    options.CleanupInterval = TimeSpan.FromMinutes(60);
}, new SQLite3Provider_e_sqlite3());

// Register FusionCache with L1 + L2
builder.Services.AddFusionCache()
    .WithDefaultEntryOptions(options =>
    {
        options.SetDuration(TimeSpan.FromMinutes(10));
        options.SetFailSafe(true,TimeSpan.FromHours(1));
    })
    .WithSerializer(new FusionCacheSystemTextJsonSerializer()) // Required for L2
    .WithDistributedCache(sp => sp.GetRequiredService<IDistributedCache>());

// Clear default providers and plug in NLog
builder.Logging.ClearProviders();
// Environment‑specific minimum level
if (builder.Environment.IsDevelopment())
{
    builder.Logging.SetMinimumLevel(LogLevel.Trace);       // everything for debugging
}
else if (builder.Environment.IsStaging())
{
    builder.Logging.SetMinimumLevel(LogLevel.Debug);       // detailed but less noisy
}
else if (builder.Environment.IsProduction())
{
    builder.Logging.SetMinimumLevel(LogLevel.Information); // clean, readable logs
}
builder.Host.UseNLog();

// Add services to the container.
builder.Services.AddControllers(options =>
{
    options.InputFormatters.Insert(0, new PlainTextInputFormatter());
    
}).AddJsonOptions(options =>
{
    options.JsonSerializerOptions.Converters.Add(new EnumConverterFactory());
    options.JsonSerializerOptions.Converters.Add(new DateTimeConverterFactory());
});
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(x => SwaggerFactory.Config(x, versionInfo));

// Register Adapter (DI resolves correct generic interface)
builder.Services.AddSingleton<IJsonMapper, JsonMapper>();
builder.Services.AddJwtAuthService();
builder.Services.AddAdapterService();

builder.Services.AddHttpContextAccessor();
builder.Services.AddLogging();

builder.Services.AddApplicationValidators();
builder.Services.AddApplicationServices();

/*
 * End right here
 */

var app = builder.Build();

app.UseCors("CorsPolicy");

if (app.Environment.IsDevelopment() || app.Environment.IsStaging())
{
    app.UseSwagger();
    app.UseSwaggerUI(SwaggerFactory.Config);
}

app.UseHttpsRedirection();
// Serve static files (Commented out for pure backend CSR API refactoring)
// app.UseStaticFiles(new StaticFileOptions
// {
//     // having the WebPage as the entrypoint of the WHOLE web app.
//     FileProvider = new PhysicalFileProvider(Path.Combine(builder.Environment.ContentRootPath, "WebPage")), 
//     RequestPath = ""
// });
app.UseMiddleware<ErrorMiddleware>();
app.UseMiddleware<TraceMiddleware>(); 
// app.UseMiddleware<SpaMiddleware>(); // Commented out for pure backend CSR API refactoring
app.UseMiddleware<AuthMiddleware>();

app.MapControllers();

// Initialize AppLog once with a resolver, and resolver reads from AsyncLocal
AppLog.Initialize(
    app.Services.GetRequiredService<ILoggerFactory>(),
    () => TraceContextHolder.CurrentTraceId.Value);

app.Run();

// Ensure NLog flushes/shuts down on exit
NLog.LogManager.Shutdown();