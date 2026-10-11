MarioKart64JS web-thin for Windows 10 and 11 (x64 and ARM64)

Plays the hosted game at https://mk64js.gokart.games/play in a Microsoft Edge app window: Edge's built-in
Chromium engine (V8, WebGL, gamepads), no tabs or address bar, 1280x960. Nothing else to install, since
Edge ships with Windows. No game files are bundled, so it needs an internet connection and always runs
the latest deployed version.

1. Unzip MarioKart64JS-web-thin-*-win.zip.
2. Double-click Install.cmd. It copies the app to %LOCALAPPDATA%\Programs\MarioKart64JS-Web, adds
   "MarioKart64JS Web" to the Start menu and the desktop, and starts the game.
   (If Windows asks whether to run a downloaded file, choose Run / More info > Run anyway.)

Other ways:
  MarioKart64JS.cmd   play straight from the unzipped folder, without installing
  Uninstall.cmd       removes the shortcuts, the app folder and its saved settings

Other URL (e.g. a local server):  set MK64_WEB_URL=http://192.168.1.10:5173/play  then run Install.cmd
G cycles the resolution (240p / 480p / 960p / native). F11 toggles full screen.
