$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../test-output/geometry-proof'))
$data = Get-Content -LiteralPath (Join-Path $outputRoot 'comparison-data.json') -Raw | ConvertFrom-Json
$source = [System.Drawing.Image]::FromFile((Join-Path $outputRoot 'source.png'))
try {
    foreach ($mode in @('original', 'proposed')) {
        $bitmap = [System.Drawing.Bitmap]::new($source.Width, $source.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.DrawImageUnscaled($source, 0, 0)
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            foreach ($segment in $data.$mode) {
                $colour = if ($mode -eq 'original') { '#ffe45c' } elseif ($segment.reviewRequired) { '#ff9d3d' } elseif ($segment.kind -eq 'door') { '#ff75d8' } else { '#48f5d0' }
                $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($colour), 3)
                try {
                    if ($segment.reviewRequired) { $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash }
                    $graphics.DrawLine($pen, [single]($segment.a[0] * $source.Width), [single]($segment.a[1] * $source.Height), [single]($segment.b[0] * $source.Width), [single]($segment.b[1] * $source.Height))
                } finally { $pen.Dispose() }
            }
            $bitmap.Save((Join-Path $outputRoot "$mode.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $source.Dispose() }
Write-Output 'Rendered original and proposed overlays from the same geometry used by the HTML viewer.'
