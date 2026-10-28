<#
  Servidor web local mínimo para jugar sin instalar nada (solo requiere Windows PowerShell).
  Uso:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-NoBrowser]
  Solo escucha en 127.0.0.1 (localhost) y únicamente sirve archivos de esta carpeta.
#>
param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$root = $root.TrimEnd('\')

# Si el puerto está ocupado (por ejemplo, otra ventana del servidor abierta) se prueban los siguientes
$listener = $null
$firstPort = $Port
for ($candidate = $firstPort; $candidate -lt $firstPort + 20; $candidate++) {
  $attempt = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
  try {
    $attempt.Start()
    $listener = $attempt
    $Port = $candidate
    break
  } catch {
    Write-Host "El puerto $candidate está ocupado, probando el siguiente..." -ForegroundColor DarkYellow
  }
}
if (-not $listener) {
  Write-Host "No hay ningún puerto libre entre $firstPort y $($firstPort + 19). Cierra otras ventanas del servidor o usa: .\serve.ps1 -Port 9000" -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Parcel Empire: Delivery Tycoon" -ForegroundColor Yellow
Write-Host "  Servidor activo en $url" -ForegroundColor Green
Write-Host "  Pulsa Ctrl+C para detenerlo." -ForegroundColor DarkGray
Write-Host ""

# Cada conexión se atiende en su propio hilo para que los sockets inactivos del navegador no bloqueen al resto.
$handler = {
  param($client, $root)
  $mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  }
  try {
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $buffer = New-Object byte[] 8192
    $request = ''
    while ($request -notmatch "`r`n`r`n" -and $request.Length -lt 16384) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      $request += [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    }
    if ($request -notmatch '^(GET|HEAD) (\S+) HTTP/1\.[01]') { return }
    $method = $Matches[1]
    $target = $Matches[2]
    $path = [System.Uri]::UnescapeDataString(($target -split '\?')[0]).TrimStart('/').Replace('/', '\')
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }

    $status = '200 OK'
    $type = 'text/plain; charset=utf-8'
    $body = [byte[]]@()
    $full = $null
    try { $full = [System.IO.Path]::GetFullPath((Join-Path $root $path)) } catch { $full = $null }
    # Evita salir de la carpeta del juego (path traversal)
    if ($full -and $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($full)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $type = $mime[$ext] } else { $type = 'application/octet-stream' }
      $body = [System.IO.File]::ReadAllBytes($full)
    } else {
      $status = '404 Not Found'
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 - No encontrado')
    }
    $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  } catch {
    # Conexión cerrada por el navegador: no hay nada que hacer
  } finally {
    $client.Close()
  }
}

$pool = [runspacefactory]::CreateRunspacePool(1, 16)
$pool.Open()
$running = New-Object System.Collections.ArrayList

if (-not $NoBrowser) { Start-Process $url }

try {
  while ($true) {
    # Se consulta con Pending() para que Ctrl+C siga funcionando mientras se espera
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 30
      continue
    }
    $client = $listener.AcceptTcpClient()
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($client).AddArgument($root)
    [void]$running.Add(@{ Shell = $ps; Result = $ps.BeginInvoke() })
    # Libera las conexiones ya terminadas
    for ($i = $running.Count - 1; $i -ge 0; $i--) {
      if ($running[$i].Result.IsCompleted) { $running[$i].Shell.Dispose(); $running.RemoveAt($i) }
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
