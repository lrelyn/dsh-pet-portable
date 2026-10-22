# Creates the desktop shortcut with the whale-girl icon.
# Run from INSIDE the unpacked pet folder.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as GBK,
# which corrupts CJK literals. All names are discovered by pattern instead.
#
# Usage: right-click this file -> Run with PowerShell.

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

# The launcher is the only exe at the package root
$exe = Get-ChildItem $root -Filter '*.exe' | Select-Object -First 1
if (-not $exe) { Write-Host 'cannot find the pet exe next to this script'; exit 1 }

# The icon is the only .ico under app\assets
$ico = Get-ChildItem (Join-Path $root 'app\assets') -Filter '*.ico' -Recurse | Select-Object -First 1
if (-not $ico) { Write-Host 'cannot find the icon file'; exit 1 }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'DaFeiYuPet.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $exe.FullName
$s.WorkingDirectory = $root
$s.IconLocation = $ico.FullName + ',0'
$s.Description = 'Desktop pet launcher'
$s.Save()

Write-Host 'Shortcut created on Desktop:'
Write-Host ('  target: {0}' -f $exe.FullName)
Write-Host ('  icon:   {0}' -f $ico.FullName)