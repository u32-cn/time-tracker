@echo off
set TT_DEBUG=1
cd /d S:\vtxf\vtxf-work\projects\vtxf\time-tracker-202611
node_modules\electron\dist\electron.exe . > "%TEMP%\tt-task.log" 2>&1
