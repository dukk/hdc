@echo off
setlocal
set "ROOT=%~dp0"
set "HDC_CLI_INVOCATION=%~n0"
set "HDC_PRELOAD=%ROOT%apps\hdc-cli\lib\package\preload.mjs"
node --import "file:///%ROOT:\=/%apps/hdc-cli/lib/package/preload.mjs" "%ROOT%apps\hdc-cli\cli.mjs" %*
