# Digital CD Library and ESP32 Music Display

The `music_hub` firmware combines the Last.fm music display and NFC CD library on one ESP32. Choose a mode on its touch screen without uploading another sketch.

## Combined firmware for the ESP32-2432S028R

1. Copy `music_hub/secrets.h.example` to `music_hub/secrets.h` and enter your Wi-Fi name and password, Last.fm username, and Last.fm API key. Git ignores `secrets.h`.
2. Install the ESP32 Arduino core and the ArduinoJson, TFT_eSPI, TJpg_Decoder, Adafruit PN532, Adafruit BusIO, and **XPT2046_Bitbang_Slim** libraries. Configure TFT_eSPI for this display on HSPI (`USE_HSPI_PORT`). Keep the PN532 on the SPI connector with the wiring in [Test the NFC reader](#test-the-nfc-reader).
3. Open `music_hub/music_hub.ino` in Arduino IDE, select the ESP32 board and its port, and upload.
4. On first boot, tap the three touch targets in order, lifting your finger between taps. Calibration is saved on the ESP32. Use **Calibrate touch** on the home screen if you need to repeat it.
5. Tap **Listening** to see the current or most recently observed Last.fm track. Tap **HOME**, then **CD Library** to scan stickers. Keep the USB bridge running for CD lookups and cover art. The browser at `http://127.0.0.1:8317/` still handles first-time CD entry.

The older `music_display` and `nfc_library` sketches remain available as independent diagnostics. The combined firmware needs Wi-Fi only in Listening mode; CD scans still travel over USB to the local bridge. If the PN532 is unavailable, the home screen and Listening mode can still run.

## Supabase account sign-in

The website's header has email sign-up, sign-in, and sign-out using the project's URL and **publishable** key in `supabase-config.js`. The publishable key is safe in browser code only because the database tables have row level security policies. Never add a Supabase `sb_secret_` key or database password to this repository or the website.

Signing in does not yet migrate or sync the CD library. The USB bridge continues using the local SQLite database, and the GitHub Pages version continues using that browser's local storage. The next step is to add a reviewed import into the account's `cds` and `tag_links` tables and then update the bridge lookup flow.

Supabase's default email sender is intended for testing with project team email addresses. Public sign-ups will need a configured SMTP provider.

## Digital CD Library webpage

The companion website is at the repository root. Serve this folder locally (for example, `python -m http.server 8000`) and open `http://localhost:8000/`.

Select **Add CD**, enter an album and artist, choose the matching CD edition, review its cover and track list, then save it. Search and track data come from [MusicBrainz](https://musicbrainz.org/); cover images come from the [Cover Art Archive](https://coverartarchive.org/). MusicBrainz requests are spaced apart, successful results are reused during the page session, and temporary busy responses are retried. A missing cover displays a placeholder.

The GitHub Pages library uses browser local storage. It stays on the same browser and origin, with no account or sync yet. A local USB NFC bridge is available below for the first scan-to-web workflow.

Once you have saved CDs, switch between **Grid** and **Stack** views. Your view choice is saved in this browser and restored after refresh. Stack view shows your albums as a pile of clear jewel cases. Hover or focus on a case to preview its album. Drag the top case left or right, select a case underneath, or use the arrow buttons and left/right arrow keys to browse. The front case slides out and returns underneath as the next CD comes forward. Animation is on by default and can be turned off with the button above the stack. Select the top case or **View CD details** to open it.

## Standalone Listening sketch

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

## NFC library workflow (local prototype)

The local bridge reads the `Tag detected. UID: ...` lines from the ESP32, saves scans and CDs in a local SQLite database, and serves this website at `http://127.0.0.1:8317/`. A new tag opens the Add CD flow in the website; after saving, another scan brings up the linked album in the website's scan panel and on the ESP32 screen. The tag stores only its factory UID; album information is stored in the database.

1. Upload `nfc_library/nfc_library.ino` to the ESP32. It uses Adafruit PN532, ArduinoJson, TFT_eSPI, and TJpg_Decoder. Keep the same PN532 wiring described above. This board's TFT_eSPI setup must use its display pins on **HSPI** (`USE_HSPI_PORT`), leaving the NFC reader on VSPI. The sketch temporarily replaces the music-display sketch while you test the CD library.
2. Keep the ESP32 connected by USB. Close Arduino Serial Monitor, which otherwise holds the COM port.
3. Install the bridge's serial and image libraries once: `python -m pip install -r requirements.txt`.
4. Run `python local_bridge.py --serial COM3` from the repository folder. Replace `COM3` if Arduino IDE shows a different port.
5. Open `http://127.0.0.1:8317/` on **this computer**. The NFC panel appears above the library.
6. Scan a sticker. Search for its album and artist, select the correct CD edition, and save. Scan it again to see the saved CD in the NFC panel and a jewel case style view with album art, title, artist, and track count on the ESP32.

The bridge obtains cover art from the Cover Art Archive, resizes it to 160 × 160 pixels, and caches it in ignored `local_data/covers/`. It sends the image and a short lookup result to the ESP32 over USB serial. The ESP32 does not need Wi-Fi or secrets for this mode. If an album has no available cover or the art service is offline, the screen shows a disc placeholder. The bridge listens on localhost only and has no account or remote access. Its database is in ignored `local_data/`. The GitHub Pages site remains browser-only until a hosted backend and authentication are added. Browser-local CDs from the GitHub Pages origin are not automatically imported into this local database.

Keep `secrets.h` private. Git ignores it, but verify staged files before pushing. The sketch currently uses `WiFiClientSecure::setInsecure()` for HTTPS requests, which skips certificate validation. This is suitable only for testing; a network attacker could intercept the Last.fm API key or alter responses.
