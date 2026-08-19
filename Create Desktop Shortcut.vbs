' Run this once (double-click it) to add two icons to your Desktop:
' "Launch Click Recorder" - starts the app
' "Uninstall Click Recorder" - removes it later, if you ever want to

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set oWS = WScript.CreateObject("WScript.Shell")
strDesktop = oWS.SpecialFolders("Desktop")

' --- "Launch Click Recorder" shortcut, points at run.bat ---
sLinkFile = strDesktop & "\Launch Click Recorder.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = scriptDir & "\run.bat"
oLink.WorkingDirectory = scriptDir
oLink.WindowStyle = 1
oLink.Description = "Launch Click Recorder - Screen Recording"
oLink.Save

' --- "Uninstall Click Recorder" shortcut, points at Uninstall.vbs ---
sUninstallLink = strDesktop & "\Uninstall Click Recorder.lnk"
Set oUninstallLink = oWS.CreateShortcut(sUninstallLink)
oUninstallLink.TargetPath = "wscript.exe"
oUninstallLink.Arguments = """" & scriptDir & "\Uninstall.vbs"""
oUninstallLink.WorkingDirectory = scriptDir
oUninstallLink.WindowStyle = 1
oUninstallLink.Description = "Remove Click Recorder from this computer"
oUninstallLink.Save

MsgBox "Done! Two icons were added to your Desktop:" & vbCrLf & vbCrLf & _
    "- ""Launch Click Recorder"" - opens the app" & vbCrLf & _
    "- ""Uninstall Click Recorder"" - removes it later, if you ever want to", _
    64, "Click Recorder"
