' Run this to remove Click Recorder from your computer.
' Just double-click it and click Yes/No on the pop-ups - no typing needed.
' (This is also what the "Uninstall Click Recorder" Desktop icon runs.)

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set oWS = WScript.CreateObject("WScript.Shell")
strDesktop = oWS.SpecialFolders("Desktop")

answer = MsgBox("This will remove Click Recorder's Desktop icons and installed files." & vbCrLf & vbCrLf & "Continue?", vbYesNo + vbQuestion, "Uninstall Click Recorder")
If answer = vbNo Then
    WScript.Quit
End If

' Remove the "Launch Click Recorder" desktop shortcut
launchShortcut = strDesktop & "\Launch Click Recorder.lnk"
If fso.FileExists(launchShortcut) Then
    fso.DeleteFile launchShortcut, True
End If

' Remove the "Uninstall Click Recorder" desktop shortcut (this one)
uninstallShortcut = strDesktop & "\Uninstall Click Recorder.lnk"
If fso.FileExists(uninstallShortcut) Then
    fso.DeleteFile uninstallShortcut, True
End If

' Remove installed dependencies
modulesPath = scriptDir & "\node_modules"
If fso.FolderExists(modulesPath) Then
    fso.DeleteFolder modulesPath, True
End If

' Saved SOPs are the user's own work, so ask about that separately
dataAnswer = MsgBox("Do you also want to delete your saved SOPs and settings?" & vbCrLf & vbCrLf & "This cannot be undone.", vbYesNo + vbExclamation, "Delete Saved Data?")
If dataAnswer = vbYes Then
    appDataPath = oWS.ExpandEnvironmentStrings("%APPDATA%") & "\click-recorder"
    If fso.FolderExists(appDataPath) Then
        fso.DeleteFolder appDataPath, True
    End If
End If

MsgBox "Done! Click Recorder has been uninstalled." & vbCrLf & vbCrLf & "The last step is to drag this folder to the Recycle Bin:" & vbCrLf & scriptDir, vbInformation, "Uninstall Complete"
