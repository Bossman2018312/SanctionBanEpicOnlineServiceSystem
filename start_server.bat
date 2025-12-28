@echo off
title MirrorVR Server
echo ---------------------------------------------------
echo     STARTING MIRROR VR BAN SYSTEM SERVER
echo ---------------------------------------------------

:: IMPORTANT: Replace the path below with the folder where your server.js is located!
cd /d "D:\Development\server.js"

:: Start the server
node server.js

:: Keep window open if it crashes so you can read the error
pause