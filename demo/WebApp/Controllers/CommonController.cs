using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace WebApp.Controllers;

/// <summary>
/// 提供共用的資訊
/// </summary>
[AllowAnonymous]
public class CommonController: BaseController
{
    private readonly IHostEnvironment _environment;
    private readonly IConfiguration _configuration;

    public CommonController(
        IHostEnvironment environment,
        IConfiguration configuration)
    {
        _environment = environment;
        _configuration = configuration;
    }
    
    /// <summary>
    /// 版本編號
    /// </summary>
    /// <returns></returns>
    [HttpGet("Version")]
    public async Task<IActionResult> Version()
    {
        var version = _configuration["VersionInfo"];
        return Ok(new
        {
            version = version
        });
    }
}