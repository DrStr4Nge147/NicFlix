param(
  [string]$OutputPath = "build\icon.ico"
)

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-FaviconPngBytes {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 24
  $red = [System.Drawing.ColorTranslator]::FromHtml("#e63b3b")
  $pen = New-Object System.Drawing.Pen $red, ([Math]::Max(1.25, 2 * $scale))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $rect = New-RoundedRectPath -X (3 * $scale) -Y (3 * $scale) -Width (18 * $scale) -Height (18 * $scale) -Radius (2 * $scale)
  $graphics.DrawPath($pen, $rect)

  $lines = @(
    @(7, 3, 7, 21),
    @(17, 3, 17, 21),
    @(3, 7.5, 7, 7.5),
    @(3, 12, 21, 12),
    @(3, 16.5, 7, 16.5),
    @(17, 7.5, 21, 7.5),
    @(17, 16.5, 21, 16.5)
  )

  foreach ($line in $lines) {
    $graphics.DrawLine(
      $pen,
      [float]($line[0] * $scale),
      [float]($line[1] * $scale),
      [float]($line[2] * $scale),
      [float]($line[3] * $scale)
    )
  }

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()

  $graphics.Dispose()
  $bitmap.Dispose()
  $stream.Dispose()
  $pen.Dispose()
  $rect.Dispose()

  return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  [pscustomobject]@{
    Size = $size
    Bytes = New-FaviconPngBytes -Size $size
  }
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir) {
  New-Item -ItemType Directory -Force $outputDir | Out-Null
}

$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create))
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$images.Count)

  $offset = 6 + ($images.Count * 16)
  foreach ($image in $images) {
  $encodedSize = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $writer.Write([byte]$encodedSize)
  $writer.Write([byte]$encodedSize)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$image.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Bytes.Length
  }

  foreach ($image in $images) {
    $writer.Write($image.Bytes)
  }
} finally {
  $writer.Dispose()
}

Write-Output "Created $OutputPath"
