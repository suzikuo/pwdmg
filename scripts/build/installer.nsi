; ==============================================================================
; My Password - NSIS Modern Installer Script
; ==============================================================================

Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "My Password"
!endif

!ifndef PRODUCT_PUBLISHER
  !define PRODUCT_PUBLISHER "suzikuo"
!endif

!ifndef VERSION
  !define VERSION "2.0.56"
!endif

!ifndef SRCDIR
  !define SRCDIR "..\..\release\desktop"
!endif

!ifndef OUTFILE
  !define OUTFILE "..\..\release\My Password-Setup.exe"
!endif

!ifndef ICON_PATH
  !define ICON_PATH "..\..\src-tauri\icons\icon.ico"
!endif

!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define NM_HOST_NAME "com.suzikuo.mypwdmg"

Name "${PRODUCT_NAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" "InstallDir"

!include "MUI2.nsh"
!include "FileFunc.nsh"

; MUI Settings
!define MUI_ABORTWARNING

; Installer Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\My Password.exe"
!define MUI_FINISHPAGE_RUN_TEXT "运行 ${PRODUCT_NAME}"
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; Languages (Default SimpChinese, English fallback)
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ------------------------------------------------------------------------------
; Helper Functions
; ------------------------------------------------------------------------------
Function EscapeJsonPath
  Exch $0 ; input string
  Push $1 ; char
  Push $2 ; result
  Push $3 ; len
  Push $4 ; index

  StrCpy $2 ""
  StrLen $3 $0
  StrCpy $4 0

  loop:
    StrCmp $4 $3 done
    StrCpy $1 $0 1 $4
    IntOp $4 $4 + 1
    StrCmp $1 "\" escape_bs
    StrCpy $2 "$2$1"
    Goto loop

  escape_bs:
    StrCpy $2 "$2\\"
    Goto loop

  done:
    Pop $4
    Pop $3
    Pop $1
    StrCpy $0 $2
    Pop $2
    Exch $0
FunctionEnd

; ------------------------------------------------------------------------------
; Installer Section
; ------------------------------------------------------------------------------
Section "MainSection" SEC01
  ; Close existing running instances
  nsExec::Exec 'cmd /c taskkill /F /IM "My Password.exe" >nul 2>&1'
  nsExec::Exec 'cmd /c taskkill /F /IM "My Password Host.exe" >nul 2>&1'
  Sleep 300

  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Copy all staged desktop files recursively
  File /r "${SRCDIR}\*.*"

  ; Create Native Messaging directory
  CreateDirectory "$INSTDIR\native-host"

  ; Preserve existing valid Native Messaging Host registration if it already exists
  ReadRegStr $2 HKCU "Software\Google\Chrome\NativeMessagingHosts\${NM_HOST_NAME}" ""
  IfFileExists "$2" skip_nm_reg 0

  ; Fallback: write template manifest without invalid wildcard
  FileOpen $0 "$INSTDIR\native-host\${NM_HOST_NAME}.json" w
  FileWrite $0 '{\$\r\n'
  FileWrite $0 '  "name": "${NM_HOST_NAME}",\$\r\n'
  FileWrite $0 '  "description": "My Password native messaging host",\$\r\n'

  Push "$INSTDIR\My Password Host.exe"
  Call EscapeJsonPath
  Pop $1

  FileWrite $0 '  "path": "$1",\$\r\n'
  FileWrite $0 '  "type": "stdio",\$\r\n'
  FileWrite $0 '  "allowed_origins": []\$\r\n'
  FileWrite $0 '}$\r\n'
  FileClose $0

  skip_nm_reg:

  ; Store installation folder
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallDir" "$INSTDIR"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\My Password.exe" "" "$INSTDIR\My Password.exe" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

  ; Create Desktop shortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\My Password.exe" "" "$INSTDIR\My Password.exe" 0

  ; Write Add/Remove Programs registry keys
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\My Password.exe,0"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

; ------------------------------------------------------------------------------
; Uninstaller Section
; ------------------------------------------------------------------------------
Section "Uninstall"
  ; Close existing running instances
  nsExec::Exec 'cmd /c taskkill /F /IM "My Password.exe" >nul 2>&1'
  nsExec::Exec 'cmd /c taskkill /F /IM "My Password Host.exe" >nul 2>&1'
  Sleep 300

  ; Remove shortcuts
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove Native Messaging Host registry keys
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${NM_HOST_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${NM_HOST_NAME}"

  ; Remove Add/Remove Programs registry keys
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"

  ; Delete files and directory
  RMDir /r "$INSTDIR\browser-extension"
  RMDir /r "$INSTDIR\native-host"
  Delete "$INSTDIR\My Password.exe"
  Delete "$INSTDIR\My Password Host.exe"
  Delete "$INSTDIR\browser-extension.zip"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
SectionEnd
