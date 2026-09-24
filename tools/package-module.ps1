$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $repoRoot 'module.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedDownload = "https://github.com/chrisgodfrey/scene-architect/releases/download/v$($manifest.version)/scene-architect.zip"
if ($manifest.id -ne 'scene-architect' -or $manifest.download -ne $expectedDownload) {
    throw 'Manifest ID or versioned download URL does not match the release package.'
}

$outputDirectory = Join-Path $repoRoot 'dist'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archivePath = Join-Path $outputDirectory 'scene-architect.zip'

# Explicit runtime allowlist: never ship dependencies, tests, Git data or browser profiles.
$files = @(
    Get-Item -LiteralPath $manifestPath
    Get-Item -LiteralPath (Join-Path $repoRoot 'README.md')
    foreach ($directory in @('scripts', 'styles', 'templates', 'fixtures')) {
        Get-ChildItem -LiteralPath (Join-Path $repoRoot $directory) -File -Recurse
    }
) | Sort-Object FullName

$archive = [System.IO.Compression.ZipArchive]::new(
    [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create),
    [System.IO.Compression.ZipArchiveMode]::Create
)
try {
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}

# Read the completed archive, check the root manifest and verify every packaged byte.
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $files.Count -or -not $archive.GetEntry('module.json')) {
        throw 'Archive is missing its root manifest or has an unexpected file count.'
    }
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
        $entry = $archive.GetEntry($entryName)
        if (-not $entry) { throw "Missing archive entry: $entryName" }
        $stream = $entry.Open()
        try { $actualHash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash }
        finally { $stream.Dispose() }
        if ($actualHash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) {
            throw "Archive content differs from source: $entryName"
        }
    }
} finally {
    $archive.Dispose()
}

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $outputDirectory 'module.json') -Force
Write-Output "Verified $($files.Count) files for Scene Architect $($manifest.version)."
Write-Output "Archive: $archivePath"
Write-Output "Release tag: v$($manifest.version)"
Write-Output "Expected download: $expectedDownload"
Write-Output 'Packaging is local only. It does not publish a GitHub release.'
