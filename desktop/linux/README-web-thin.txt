MarioKart64JS web-thin for Linux (x64 and arm64, Raspberry Pi included)

Plays the hosted game at https://mk64js.gokart.games/play in a Chrome or Chromium app window: no tabs or
address bar, 1280x960, its own profile. No game files are bundled, so it needs an internet connection and
always runs the latest deployed version.

1. Unpack:
     tar -xzf MarioKart64JS-web-thin-*-linux.tar.gz
2. Install (one step):
     ./MarioKart64JS-web-thin/install.sh
   If no Chrome, Chromium, Edge or Brave is installed, it installs Google Chrome on x64 (apt / dnf) or
   Chromium on arm64 and other distros. Then it adds "MarioKart64JS Web" to the Games menu, adds a
   `mariokart64js-web` command and starts the game.

Other ways:
  ./MarioKart64JS-web-thin/MarioKart64JS     play without installing
  ./install.sh --uninstall                    removes the app, menu entry and saved settings
With no Chromium-based browser it falls back to a WebKitGTK window (sudo apt install python3-gi gir1.2-webkit2-4.1).

Pick a browser:  MK64_BROWSER=chromium ./MarioKart64JS
Other URL (e.g. a local server):  MK64_WEB_URL=http://192.168.1.10:5173/play ./MarioKart64JS
G cycles the resolution (240p / 480p / 960p / native); on a Pi, 240p or 480p runs smoothest. F11 toggles full screen.
