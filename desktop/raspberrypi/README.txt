MarioKart64JS for Raspberry Pi (Linux webview app)

A small GTK window around the system WebKitGTK, 1280x960 like the Windows, Linux and macOS apps.
Made for Raspberry Pi OS (64-bit, Bookworm) on a Pi 3, Pi 4 or Pi 5; any Linux with WebKitGTK runs it.

1. Install the webview (once):
     sudo apt install python3-gi gir1.2-webkit2-4.1
   (Bullseye: gir1.2-webkit2-4.0)
2. Unpack and run:
     tar -xzf MarioKart64JS-*-raspberrypi.tar.gz
     ./MarioKart64JS/MarioKart64JS
3. Optional: ./MarioKart64JS/install-menu-entry.sh adds it to the Games menu.

G cycles the resolution (240p / 480p / 960p / native); on a Pi, 240p or 480p runs smoothest.
2P-4P GAME races online against other players (mk64js.gokart.games).
