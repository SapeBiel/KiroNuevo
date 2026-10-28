<#
  Comprobación estática sin Node: equilibrio de llaves/paréntesis y coherencia entre
  "import { x } from './y.js'" y los "export" reales de cada módulo.
  Uso:  powershell -ExecutionPolicy Bypass -File tools\static-check.ps1
#>
param([string]$Root = '')
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$root = $Root
# La librería de terceros (js\vendor) se descarta: no es código del proyecto
$files = Get-ChildItem -Path (Join-Path $root 'js'), (Join-Path $root 'tests') -Recurse -Filter *.js |
  Where-Object { $_.FullName -notmatch '[\\/]vendor[\\/]' }
$errors = 0

function Test-Balance([string]$text, [string]$name) {
  $stack = New-Object System.Collections.Generic.Stack[object]
  $i = 0; $n = $text.Length; $line = 1; $prev = ''
  $pairs = @{ ')' = '('; ']' = '['; '}' = '{' }
  while ($i -lt $n) {
    $c = $text[$i]
    if ($c -eq "`n") { $line++; $i++; continue }
    # dentro de una plantilla solo importan ` de cierre y ${ de apertura
    if ($stack.Count -gt 0 -and $stack.Peek()[0] -eq '`') {
      if ($c -eq '\') { $i += 2; continue }
      if ($c -eq '`') { [void]$stack.Pop(); $i++; $prev = 'x'; continue }
      if ($c -eq '$' -and $i + 1 -lt $n -and $text[$i + 1] -eq '{') { $stack.Push(@('${', $line)); $i += 2; $prev = '{'; continue }
      $i++; continue
    }
    # comentarios
    if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '/') { while ($i -lt $n -and $text[$i] -ne "`n") { $i++ }; continue }
    if ($c -eq '/' -and $i + 1 -lt $n -and $text[$i + 1] -eq '*') {
      $i += 2
      while ($i + 1 -lt $n -and -not ($text[$i] -eq '*' -and $text[$i + 1] -eq '/')) { if ($text[$i] -eq "`n") { $line++ }; $i++ }
      $i += 2; continue
    }
    # cadenas simples y dobles
    if ($c -eq "'" -or $c -eq '"') {
      $q = $c; $i++
      while ($i -lt $n -and $text[$i] -ne $q) {
        if ($text[$i] -eq '\') { $i++ }
        if ($i -lt $n -and $text[$i] -eq "`n") { return "Línea ${line}: cadena sin cerrar" }
        $i++
      }
      $i++; $prev = 'x'; continue
    }
    if ($c -eq '`') {
      $stack.Push(@('`', $line)); $i++; $prev = 'x'
      continue
    }
    # expresiones regulares
    if ($c -eq '/' -and ($prev -eq '' -or '(,=:[!&|?{};'.Contains($prev))) {
      $i++; $inClass = $false
      while ($i -lt $n) {
        $ch = $text[$i]
        if ($ch -eq '\') { $i += 2; continue }
        if ($ch -eq '[') { $inClass = $true } elseif ($ch -eq ']') { $inClass = $false }
        elseif ($ch -eq '/' -and -not $inClass) { break }
        elseif ($ch -eq "`n") { return "Línea ${line}: regex sin cerrar" }
        $i++
      }
      $i++; $prev = 'x'; continue
    }
    if ('([{'.Contains($c)) { $stack.Push(@([string]$c, $line)) }
    elseif (')]}'.Contains($c)) {
      if ($stack.Count -eq 0) { return "Línea ${line}: '$c' sin abrir" }
      $top = $stack.Pop()
      if ($c -eq '}' -and $top[0] -eq '${') { $i++; $prev = 'x'; continue }
      if ($top[0] -ne $pairs[[string]$c]) { return "Línea ${line}: '$c' no coincide con '$($top[0])' abierto en la línea $($top[1])" }
    }
    if (-not [char]::IsWhiteSpace($c)) { $prev = [string]$c }
    $i++
  }
  if ($stack.Count -gt 0) { $t = $stack.Pop(); return "Sin cerrar '$($t[0])' abierto en la línea $($t[1])" }
  return $null
}

# Exportaciones de cada archivo
$exports = @{}
foreach ($f in $files) {
  $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  $names = New-Object System.Collections.Generic.HashSet[string]
  foreach ($m in [regex]::Matches($text, 'export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)')) { [void]$names.Add($m.Groups[1].Value) }
  foreach ($m in [regex]::Matches($text, 'export\s*\{([^}]*)\}')) {
    foreach ($part in $m.Groups[1].Value.Split(',')) { $p = ($part.Trim() -split '\s+as\s+')[-1].Trim(); if ($p) { [void]$names.Add($p) } }
  }
  $exports[$f.FullName] = $names
}

foreach ($f in $files) {
  $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  $rel = $f.FullName.Substring($root.Length + 1)
  $problem = Test-Balance $text $rel
  if ($problem) { Write-Host "ERROR de sintaxis en ${rel}: $problem" -ForegroundColor Red; $errors++ }

  foreach ($m in [regex]::Matches($text, 'import\s*\{([^}]*)\}\s*from\s*[''"]([^''"]+)[''"]')) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $f.DirectoryName $m.Groups[2].Value))
    if (-not (Test-Path -LiteralPath $target)) { Write-Host "ERROR: ${rel} importa un archivo inexistente: $($m.Groups[2].Value)" -ForegroundColor Red; $errors++; continue }
    foreach ($part in $m.Groups[1].Value.Split(',')) {
      $imported = ($part.Trim() -split '\s+as\s+')[0].Trim()
      if (-not $imported) { continue }
      if (-not $exports[$target].Contains($imported)) { Write-Host "ERROR: ${rel} importa '$imported' que no exporta $($m.Groups[2].Value)" -ForegroundColor Red; $errors++ }
    }
  }
}

if ($errors -eq 0) {
  Write-Host "Comprobación estática correcta: $($files.Count) archivos sin errores de llaves ni de importaciones." -ForegroundColor Green
  if ($PSCommandPath) { exit 0 } else { return }
}
Write-Host "$errors problema(s) encontrados." -ForegroundColor Red
if ($PSCommandPath) { exit 1 }
