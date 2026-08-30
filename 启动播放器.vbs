' 双击启动音乐播放器：后台运行本地服务器并打开浏览器（无命令行窗口）
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "cmd /c node server.mjs", 0, False
WScript.Sleep 1000
sh.Run "http://localhost:5181"
