# 仓位管理系统 - 桌面快捷方式安装器
# 1) 基于 app/assets/icon.svg 的设计程序化生成 256x256 ICO
# 2) 在桌面创建一个指向 start-app.vbs 的快捷方式

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root         = $PSScriptRoot
$iconDir      = Join-Path $root 'app\assets'
$iconPath     = Join-Path $iconDir 'icon.ico'
$vbsPath      = Join-Path $root 'start-app.vbs'
$desktop      = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '仓位管理系统.lnk'

if (-not (Test-Path $iconDir)) {
  New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

function New-RoundedRect {
  param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x,           $y,           $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y,           $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0,   90)
  $path.AddArc($x,           $y + $h - $d, $d, $d, 90,  90)
  $path.CloseFigure()
  return $path
}

# === 绘制图标 (坐标参考 app/assets/icon.svg, 缩放 0.5 到 256x256) ===
$size = 256
$bmp = [System.Drawing.Bitmap]::new($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# 渐变背景 (圆角矩形)
$bgPath = New-RoundedRect 0 0 $size $size 66
$bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.PointF]::new(0, 0),
  [System.Drawing.PointF]::new($size, $size),
  [System.Drawing.Color]::FromArgb(223, 233, 223),
  [System.Drawing.Color]::FromArgb(127, 154, 132)
)
$g.FillPath($bgBrush, $bgPath)

# 内部白色面板 (#f9faf6 @ 0.94)
$panelPath = New-RoundedRect 51 63 154 122 19
$g.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(240, 249, 250, 246)), $panelPath)

# 顶部标题条 (#8faeb8 @ 0.6)
$titlePath = New-RoundedRect 61 76 134 30 10
$g.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(153, 143, 174, 184)), $titlePath)

# 左货架 (#9ab79d @ 0.78)
$shelf1Path = New-RoundedRect 61 114 62 57 12
$g.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(199, 154, 183, 157)), $shelf1Path)

# 右货架 (#d8c3a1 @ 0.84)
$shelf2Path = New-RoundedRect 133 114 62 57 12
$g.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(214, 216, 195, 161)), $shelf2Path)

# 右下角圆 (#58735e)
$g.FillEllipse(
  [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(88, 115, 94)),
  159, 163, 46, 46
)

# 圆内白色加号
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(248, 250, 246), 7)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, 172, 186, 192, 186)
$g.DrawLine($pen, 182, 176, 182, 196)

$g.Dispose()

# === Bitmap → PNG 字节流,组装 PNG-嵌入式 ICO ===
$pngStream = [System.IO.MemoryStream]::new()
$bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()

$ms = [System.IO.MemoryStream]::new()
$bw = [System.IO.BinaryWriter]::new($ms)
$bw.Write([uint16]0)                     # reserved
$bw.Write([uint16]1)                     # type = ICO
$bw.Write([uint16]1)                     # image count
$bw.Write([byte]0)                       # width  (0 = 256)
$bw.Write([byte]0)                       # height (0 = 256)
$bw.Write([byte]0)                       # color count (0 = > 256)
$bw.Write([byte]0)                       # reserved
$bw.Write([uint16]1)                     # color planes
$bw.Write([uint16]32)                    # bits per pixel
$bw.Write([uint32]$pngBytes.Length)      # bytes in resource
$bw.Write([uint32]22)                    # offset = 6 (header) + 16 (entry)
$bw.Write($pngBytes)
$bw.Flush()

[System.IO.File]::WriteAllBytes($iconPath, $ms.ToArray())
$bmp.Dispose()

Write-Host ""
Write-Host "  [1/2] 图标已生成: $iconPath" -ForegroundColor Green

# === 创建桌面快捷方式 ===
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath       = $vbsPath
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation     = $iconPath
$shortcut.Description      = '离线仓位管理系统'
$shortcut.WindowStyle      = 1
$shortcut.Save()

Write-Host "  [2/2] 桌面快捷方式已创建: $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "  以后双击桌面上的 [仓位管理系统] 即可启动应用。" -ForegroundColor Cyan
Write-Host "  关闭服务器请运行项目目录下的 stop-app.cmd。" -ForegroundColor Cyan
Write-Host ""
