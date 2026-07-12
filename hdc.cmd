@echo off
setlocal
set "ROOT=%~dp0"
set "HDC_CLI_INVOCATION=%~n0"
node "%ROOT%apps\hdc-cli\cli.mjs" %*
