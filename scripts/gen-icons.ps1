# 图标生成脚本: 从 app-icon.png 生成多尺寸 icon.ico 和托盘图标系列
# 用法: pwsh -File scripts/gen-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root 'assets\app-icon.png'
$icoPath = Join-Path $root 'assets\app-icon.ico'

$src = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Png([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $g.Dispose(); $bmp.Dispose(); $ms.Dispose()
  return $bytes
}

# --- 1) 多尺寸 ICO (PNG 条目, Vista+ 兼容) ---
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in $sizes) { $images.Add([byte[]](Resize-Png $s)) }

$count = $images.Count
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0)   # reserved
$bw.Write([UInt16]1)   # type = icon
$bw.Write([UInt16]$count)
$offset = 6 + 16 * $count
$dataList = New-Object System.Collections.Generic.List[byte]
for ($i = 0; $i -lt $count; $i++) {
  $s = $sizes[$i]
  $img = $images[$i]
  $len = $img.Length
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))  # width
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))  # height
  $bw.Write([byte]0)   # palette
  $bw.Write([byte]0)   # reserved
  $bw.Write([UInt16]1) # planes
  $bw.Write([UInt16]32) # bpp
  $bw.Write([UInt32]$len)
  $bw.Write([UInt32]$offset)
  $dataList.AddRange($img)
  $offset += $len
}
$bw.Write($dataList.ToArray())
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
Write-Output "ico: $icoPath ($((Get-Item $icoPath).Length / 1KB) KB, $count sizes)"

# --- 2) 托盘图标系列(16 基础 + @1.25x/@1.5x/@2x 高 DPI) ---
$traySizes = @(
  @{ Name = 'tray-icon.png';      Size = 16 },
  @{ Name = 'tray-icon@1.25x.png'; Size = 20 },
  @{ Name = 'tray-icon@1.5x.png';  Size = 24 },
  @{ Name = 'tray-icon@2x.png';    Size = 32 }
)
foreach ($t in $traySizes) {
  $p = Join-Path $root ("assets\" + $t.Name)
  [System.IO.File]::WriteAllBytes($p, (Resize-Png $t.Size))
  Write-Output "tray: $($t.Name) ($($t.Size)x$($t.Size))"
}
$src.Dispose()
Write-Output 'done'
