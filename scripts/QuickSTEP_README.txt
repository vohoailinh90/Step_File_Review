QuickSTEP -- fast local STEP viewer
===================================

Start
  Double-click QuickSTEP.exe. A console window opens and the viewer opens
  in your web browser. Drag a .step / .stp file onto the page.
  Or drag a .step file onto QuickSTEP.exe itself to open it directly.

  Keep the console window open while you use the viewer: it is the local
  helper that converts STEP files. Close it (or press Ctrl+C) to stop.

Keep the folder together
  QuickSTEP.exe needs the _internal folder next to it. Copy or move the
  whole QuickSTEP folder, never the exe alone. Unzip it near the top of a
  drive (for example C:\Tools\QuickSTEP): a very deep folder can exceed the
  Windows path-length limit, and the unzip then fails.

If the window closes straight away
  QuickSTEP stopped with an error before you could read it. Open a console
  in this folder (type cmd in the Explorer address bar, press Enter), run
  QuickSTEP.exe there, and read the message it prints.

First open of a big assembly
  The first open converts the STEP file on this PC and can take a while;
  every later open of the same file loads from the cache in seconds.
  Cache folder: %USERPROFILE%\.stepview_cache  (safe to delete).

Quality (toolbar: Coarse / Normal / Fine)
  How finely curved surfaces are cut into triangles. Choose it before
  opening a STEP file. Measurements read from the exact STEP geometry do
  not depend on it.

Nothing leaves this PC
  Conversion runs locally; the viewer works offline and talks only to the
  helper on 127.0.0.1.

"Windows protected your PC"
  The exe is not code-signed, so SmartScreen may warn on first start:
  click "More info", then "Run anyway".

Command line (optional, from a console in this folder)
  QuickSTEP.exe file.step --fine        smoother surfaces
  QuickSTEP.exe file.step --coarse      fastest, for huge assemblies
  QuickSTEP.exe --warm D:\projects      pre-convert every STEP in a folder
  QuickSTEP.exe --check                 verify the setup
