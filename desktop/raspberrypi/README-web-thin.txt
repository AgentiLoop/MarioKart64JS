MarioKart64JS web-thin for Raspberry Pi (Linux WebKit app)

A tiny GTK window around the system WebKitGTK that plays the hosted game at https://mk64js.gokart.games/play.
No game files are bundled, so it needs an internet connection and always runs the latest deployed version.
Made for Raspberry Pi OS (64-bit, Bookworm) on a Pi 3, Pi 4 or Pi 5; any Linux with WebKitGTK runs it.

1. Unpack:
     tar -xzf MarioKart64JS-web-thin-*-raspberrypi.tar.gz
     cd MarioKart64JS-web-thin
2. Install WebKit (once):
     ./install-webkit.sh
   (same as: sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1  — Bullseye: gir1.2-webkit2-4.0)
3. Run:
     ./MarioKart64JS
4. Optional: ./install-menu-entry.sh adds "MarioKart64JS Web" to the Games menu.

Other URL (e.g. a local server):  MK64_WEB_URL=http://192.168.1.10:5173/play ./MarioKart64JS
G cycles the resolution (240p / 480p / 960p / native); on a Pi, 240p or 480p runs smoothest.
