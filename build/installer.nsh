# Published v1.1.x clients pass --updated --force-run without /S.
# Apply silent mode in the downloaded installer so those clients can finish
# upgrading and relaunch without stopping at an assisted installer's final page.
# Fresh installs keep the normal installation directory picker and finish page.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend
