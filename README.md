# Digital CD Library and ESP32 Music Display

An ESP32 sketch that shows the latest track from Last.fm on a TFT display, including album art.

## Digital CD Library webpage

The companion website is at the repository root. Serve this folder locally (for example, `python -m http.server 8000`) and open `http://localhost:8000/`.

Select **Add CD**, enter an album and artist, choose the matching CD edition, review its cover and track list, then save it. Search and track data come from [MusicBrainz](https://musicbrainz.org/); cover images come from the [Cover Art Archive](https://coverartarchive.org/). MusicBrainz requests are spaced apart, successful results are reused during the page session, and temporary busy responses are retried. A missing cover displays a placeholder.

The GitHub Pages library uses browser local storage. It stays on the same browser and origin, with no account or sync yet. A local USB NFC bridge is available below for the first scan-to-web workflow.

Once you have saved CDs, switch between **Grid** and **Stack** views. Your view choice is saved in this browser and restored after refresh. Stack view shows your albums as a pile of clear jewel cases. Hover or focus on a case to preview its album. Drag the top case left or right, select a case underneath, or use the arrow buttons and left/right arrow keys to browse. The front case slides out and returns underneath as the next CD comes forward. Animation is on by default and can be turned off with the button above the stack. Select the top case or **View CD details** to open it.

## Setup

1. Copy `music_display/secrets.h.example` to `music_display/secrets.h`.
2. Enter your Wi-Fi name and password, Last.fm username, and Last.fm API key in `music_display/secrets.h`. Use an empty password (`""`) for an open Wi-Fi network.
3. Install the ESP32 Arduino core and the ArduinoJson, TFT_eSPI, and TJpg_Decoder libraries. Configure TFT_eSPI for your display and select your ESP32 board.
4. Open `music_display/music_display.ino` in the Arduino IDE and upload it to the board.

The display redraws only when the track, artwork, or playback status changes. If Last.fm stops reporting a now-playing track during an ad, it shows the last track the device saw playing. After a restart, it falls back to Last.fm's latest completed scrobble until it sees a new now-playing track.

## Test the NFC reader

The separate `nfc_test/nfc_test.ino` sketch checks the PN532 over SPI and prints a scanned tag's UID. It needs no Wi-Fi credentials and does not change the website or your saved CDs. Uploading it temporarily replaces the music-display firmware; upload `music_display/music_display.ino` again when you want the music display back.

1. With USB unplugged, set the PN532 V3 mode switches to **SPI** (switch 1 OFF, switch 2 ON). Connect ESP32 `IO23 (MOSI)` to PN532 `MOSI`, `IO19 (MISO)` to `MISO`, `IO18 (SCK)` to `SCK`, `IO27 (CS)` to `SS`, `3.3V` to `VCC`, and `GND` to `GND`. Follow the labels on your board, not wire colors. Leave `IRQ` and `RSTO` disconnected.
2. In Arduino IDE, install **Adafruit PN532** through Library Manager. Install **Adafruit BusIO** too if the IDE does not install it automatically.
3. Open `nfc_test/nfc_test.ino`, select the same ESP32 board and port you use for the music display, and upload.
4. Open **Serial Monitor** at **115200 baud**. It should print `PN532 found` and `Ready`. Hold the supplied NFC card or an NTAG213 sticker near the reader. `Tag detected. UID: ...` confirms the reader works. The tag may print repeatedly while held in place; this test only reads and never writes tags.

If it prints `PN532 not found`, unplug USB before adjusting wires, then check the mode switches and each connection. A lit red LED confirms power, not SPI communication.

## First NFC-to-web workflow (local prototype)

The local bridge reads the `Tag detected. UID: ...` lines from `nfc_test.ino`, saves scans and CDs in a local SQLite database, and serves this website at `http://127.0.0.1:8317/`. A new tag opens the Add CD flow in the website; after saving, another scan brings up the linked album in the website's scan panel. The tag stores only its factory UID; album information is stored in the database.

1. Keep the ESP32 connected by USB with `nfc_test.ino` uploaded. Close Arduino Serial Monitor, which otherwise holds the COM port.
2. Install the serial library once: `python -m pip install pyserial`.
3. Run `python local_bridge.py --serial COM3` from the repository folder. Replace `COM3` if Arduino IDE shows a different port.
4. Open `http://127.0.0.1:8317/` on **this computer**. The NFC panel appears above the library.
5. Scan a sticker. Search for its album and artist, select the correct CD edition, and save. Scan it again to see the saved CD in the NFC panel.

The bridge listens on localhost only and has no account or remote access. Its database is in ignored `local_data/`. The GitHub Pages site remains browser-only until a hosted backend and authentication are added. Browser-local CDs from the GitHub Pages origin are not automatically imported into this local database. The ESP32 test sketch still prints to Serial Monitor; displaying a linked CD on the ESP32 is a later firmware step.

Keep `secrets.h` private. Git ignores it, but verify staged files before pushing. The sketch currently uses `WiFiClientSecure::setInsecure()` for HTTPS requests, which skips certificate validation. This is suitable only for testing; a network attacker could intercept the Last.fm API key or alter responses.
