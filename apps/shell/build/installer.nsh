; AudioMorph Studio - Custom NSIS installer script
; Performs NVIDIA GPU detection via PowerShell Get-CimInstance.
; If no NVIDIA GPU is detected, prompts the user to abort or continue.

; Suppress spurious NSIS 3 warning about _.Name in customInit macro
!pragma warning disable 6000

!macro customInit
  ; Run PowerShell Get-CimInstance to detect NVIDIA GPUs (modern CIM API).
  nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_VideoController | Where-Object {$_.Name -like ''*NVIDIA*''}) { exit 0 } else { exit 1 }"'
  Pop $0 ; exit code
  Pop $1 ; stdout

  ${If} $0 != 0
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "NVIDIA GPU required for AudioMorph Studio. Install anyway?" IDYES continue_install IDNO abort_install
    abort_install:
      Abort
    continue_install:
  ${EndIf}
!macroend
