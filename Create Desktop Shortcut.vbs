' Run this once (double-click it) to add a "Click Recorder" icon to your
' Desktop that launches the app directly - no folder-hunting, no terminal.
' It just creates a shortcut pointing at run.bat in this same folder.

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set oWS = WScript.CreateObject("WScript.Shell")
strDesktop = oWS.SpecialFolders("Desktop")
sLinkFile = strDesktop & "\Click Recorder.lnk"

Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = scriptDir & "\run.bat"
oLink.WorkingDirectory = scriptDir
oLink.WindowStyle = 1
oLink.Description = "Launch Click Recorder - Screen Recording"
oLink.Save

MsgBox "Done! A ""Click Recorder"" icon was added to your Desktop." & vbCrLf & _
       "Double-click it any time to launch the app.", 64, "Click Recorder"
