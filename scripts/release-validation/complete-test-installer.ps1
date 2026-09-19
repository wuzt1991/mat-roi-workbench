$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    try {
      $process = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue
      if (-not $process -or $process.Path -notlike '*mat-upgrade-validation*' -and $process.Path -notlike '*mat-roi-workbench*' -and $process.Path -notlike '*pending*') { continue }
      if ($window.Current.Name -notmatch 'Setup|安装|地垫工作台') { continue }
      $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
      foreach ($button in $buttons) {
        if ($button.Current.IsEnabled -and -not $button.Current.IsOffscreen -and $button.Current.Name -match '^(?:&)?(?:Next|Install|Finish|下一步|安装|完成)') {
          Write-Host "NSIS wizard: $($button.Current.Name)"
          $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          break
        }
      }
    } catch { Write-Host "Wizard observation: $($_.Exception.Message)" }
  }
  Start-Sleep -Milliseconds 500
}
