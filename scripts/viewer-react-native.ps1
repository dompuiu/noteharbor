param(
  [string]$TabLabel = "viewer:rn",
  [string]$LeftCommand = "pnpm start:viewer:react-native",
  [string]$RightCommand = "pnpm dev:viewer:react-native:windows"
)

$ErrorActionPreference = "Stop"

function Get-JsonField($jsonText, $fieldPath) {
  $obj = $jsonText | ConvertFrom-Json
  $current = $obj
  foreach ($part in $fieldPath.Split(".")) {
    $current = $current.$part
  }
  return $current
}

# 1. New tab in the current (active) workspace. --focus lands you on it.
$tabJson = herdr tab create --label $TabLabel --focus | Out-String
$tabId = Get-JsonField $tabJson "result.tab.tab_id"
$leftPane = Get-JsonField $tabJson "result.root_pane.pane_id"

if (-not $tabId -or -not $leftPane) {
  throw "Failed to create Herdr tab. Response: $tabJson"
}

# 2. Split side-by-side: left stays, new pane goes right.
$splitJson = herdr pane split $leftPane --direction right --no-focus | Out-String
$rightPane = Get-JsonField $splitJson "result.pane.pane_id"

if (-not $rightPane) {
  throw "Failed to split pane. Response: $splitJson"
}

# 3. Label panes (best-effort, ignore failures).
herdr pane rename $leftPane "metro" 2>$null | Out-Null
herdr pane rename $rightPane "windows" 2>$null | Out-Null

# 4. Run one command per pane. pane run submits atomically (command + Enter).
herdr pane run $leftPane $LeftCommand | Out-Null
herdr pane run $rightPane $RightCommand | Out-Null

# 5. Ensure the new tab is focused.
herdr tab focus $tabId | Out-Null

Write-Output "Herdr tab '$TabLabel' ($tabId): left $leftPane <$LeftCommand> | right $rightPane <$RightCommand>"
