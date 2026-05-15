' Warehouse PWA - silent launcher
' Starts the local Node server in the background (no console window),
' then opens the app URL in the default browser once the port is up.
' If the server is already running, it just opens the browser.
'
' Note: keep this file ASCII-only. VBScript engine does not accept UTF-8 BOM
' and falls back to local ANSI codepage, which mangles non-ASCII bytes.

Option Explicit

Dim sh, fso, root, nodeExe, envNode, serverScript, url, i

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
serverScript = fso.BuildPath(root, "server.js")
url = "http://127.0.0.1:4173/index.html?v=20260430-export-01"

' Allow override via WAREHOUSE_APP_NODE env var; otherwise rely on node on PATH.
envNode = sh.ExpandEnvironmentStrings("%WAREHOUSE_APP_NODE%")
If envNode <> "%WAREHOUSE_APP_NODE%" And fso.FileExists(envNode) Then
  nodeExe = envNode
Else
  nodeExe = "node.exe"
End If

If Not IsServerRunning("http://127.0.0.1:4173/") Then
  sh.CurrentDirectory = root
  ' SW_HIDE = 0, bWaitOnReturn = False -> launch node hidden, do not block
  sh.Run """" & nodeExe & """ """ & serverScript & """", 0, False

  ' Poll up to ~15s for the server to come up
  For i = 1 To 30
    WScript.Sleep 500
    If IsServerRunning("http://127.0.0.1:4173/") Then
      Exit For
    End If
  Next
End If

' Open the app URL in the default browser
CreateObject("Shell.Application").ShellExecute url

Function IsServerRunning(testUrl)
  Dim req
  IsServerRunning = False
  On Error Resume Next
  Set req = CreateObject("MSXML2.XMLHTTP")
  req.Open "GET", testUrl, False
  req.Send
  If Err.Number = 0 Then
    If req.Status >= 200 And req.Status < 600 Then
      IsServerRunning = True
    End If
  End If
  Err.Clear
  On Error Goto 0
End Function
