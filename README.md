# Digital CD Library and ESP32 Music Display

The `music_hub` firmware combines the Last.fm music display and NFC CD library on one ESP32. Choose a mode on its touch screen without uploading another sketch.

## Standalone CD scans over Wi-Fi

The CD reader can now work without a computer after one-time provisioning. It needs USB power (a wall adapter or power bank), Wi-Fi, and the existing Supabase account pairing. The PN532 still connects to the ESP32 by SPI. Each scan goes from the ESP32 to the account's restricted reader endpoint over verified HTTPS. The endpoint checks the scanned UID against that account's CDs and returns a small album summary; the ESP32 downloads a 160 × 160 cover image for its case display. The website can be closed. When it is open, the scan also selects the album there.

1. In Supabase SQL Editor, run [reader-direct.sql](supabase/reader-direct.sql) after the earlier `reader-pairing.sql`. This upgrades the paired reader lookup; it does not alter CDs or tag links.
2. Make sure `music_hub/secrets.h` has your working Wi-Fi settings (it is ignored by Git). In Arduino IDE upload the updated `music_hub/music_hub.ino`. The public Supabase URL and publishable key are in `music_hub/cloud_config.h`; your reader credential is never stored in source code.
3. Stop `local_bridge.py` and close Arduino Serial Monitor so COM3 is free. With the board connected by USB, run `python tools/provision_esp32_reader.py --port COM3`. It reads the already paired credential from ignored `local_data/reader-credential.json` and stores it in the ESP32's Preferences flash without printing it. You do not need to re-pair on the website. If your credential file is gone, create a reader under **Account → My readers**, pair the bridge once using `--pair`, stop it, then provision the board.
4. Unplug the ESP32 from the computer, power it from a USB wall adapter, select **CD Library**, and scan a linked tag. The case and cover should appear. The live website will also select the album when signed in and open. An unknown tag shows **New sticker** on the ESP32; open the website to add/link it, then the screen updates after the account link is saved.

The ESP32 uses the same revocable reader credential as the USB bridge. Stop the bridge before provisioning or using direct mode; running both with one reader identity would make the online status and latest scan ambiguous. The credential survives normal firmware uploads, but erasing flash removes it. Revoke the reader in **My readers** if the device is lost. The credential is saved in device flash and can be extracted by someone with physical access to an unprotected ESP32, so treat the device as an account key. Direct mode needs a working clock from NTP to validate TLS certificates. It never sends the reader credential over an unverified TLS connection. The image proxy is used only for public album cover art; it does not receive the reader credential.

To return to USB bridge mode on a still-paired board, send `UNPAIR` over Arduino Serial Monitor at 115200 baud (newline line ending). This removes the credential from Preferences and the next scan uses the original USB protocol. It does not revoke the reader in Supabase.

## Combined firmware for the ESP32-2432S028R

1. Copy `music_hub/secrets.h.example` to `music_hub/secrets.h` and enter your Wi-Fi name and password, Last.fm username, and Last.fm API key. Git ignores `secrets.h`.
2. Install the ESP32 Arduino core and the ArduinoJson, TFT_eSPI, TJpg_Decoder, Adafruit PN532, Adafruit BusIO, and **XPT2046_Bitbang_Slim** libraries. Configure TFT_eSPI for this display on HSPI (`USE_HSPI_PORT`). Keep the PN532 on the SPI connector with the wiring in [Test the NFC reader](#test-the-nfc-reader).
3. Open `music_hub/music_hub.ino` in Arduino IDE, select the ESP32 board and its port, and upload.
4. On first boot, tap the three touch targets in order, lifting your finger between taps. Calibration is saved on the ESP32. Use **Calibrate touch** on the home screen if you need to repeat it.
5. Tap **Listening** to see the current or most recently observed Last.fm track. Tap **HOME**, then **CD Library** to scan stickers. A provisioned board looks up CDs directly over Wi-Fi. An unpaired board uses the USB bridge described below.

The older `music_display` and `nfc_library` sketches remain available as independent diagnostics. Direct CD mode and Listening mode both need Wi-Fi; unpaired USB CD mode can run without it. If the PN532 is unavailable, the home screen and Listening mode can still run.

## Supabase account sign-in

The website's header has email sign-up, sign-in, and sign-out using the project's URL and **publishable** key in `supabase-config.js`. The publishable key is safe in browser code only because the database tables have row level security policies. Never add a Supabase `sb_secret_` key or database password to this repository or the website.

Authentication is required. CDs, favorites, and tag links are stored in the signed-in user's Supabase account. The local SQLite database is an ESP32 display cache; there is no separate browser-local library.

Supabase's default email sender is intended for testing with project team email addresses. Public sign-ups will need a configured SMTP provider.

## Digital CD Library webpage

The companion website is at the repository root. Serve this folder locally (for example, `python -m http.server 8000`) and open `http://localhost:8000/`.

Select **Add CD**, enter an album and artist, choose the matching CD edition, review its cover and track list, then save it. Search and track data come from [MusicBrainz](https://musicbrainz.org/); cover images come from the [Cover Art Archive](https://coverartarchive.org/). MusicBrainz requests are spaced apart, successful results are reused during the page session, and temporary busy responses are retried. A missing cover displays a placeholder.

GitHub Pages hosts the static frontend, which connects directly to Supabase with account-scoped access. Physical USB scans require the local bridge below.

Stack is the default view; your view choice is restored after refresh. The interactive [Three.js](https://threejs.org/) jewel cases use a nearly frontal camera, cover-derived spine designs, transparent shells, and 300 ms slide animations. Hover slides a case outward; click selects it and updates the large preview. Selection remains until you select another album. Track list opens the existing details dialog; the heart saves a favorite to Supabase; the more menu offers details and removal. There is no simulated playback.

Search filters albums and artists. Grid, Artists, Genres, and Years share the same collection. Missing genre data appears under Uncategorized. New MusicBrainz additions include genres and label when supplied by the service; older records are not silently rewritten. Stacks show up to 12 cases at once; arrows and keyboard navigation continue through the filtered collection. Mobile and unavailable WebGL use accessible spine buttons. Reduced-motion settings and the animation toggle are respected.

The small header NFC indicator opens connection details. A fresh linked scan selects its album, clears search, opens Stack, and displays a temporary notification. Unknown tags retain the enrollment dialog. No serial protocol changes were needed for this redesign.

The room is a local generated photographic asset behind the interactive 3D cases and shadows; see [asset notes](assets/README.md). No new production JavaScript dependency was added. Three.js remains pinned to 0.186.1 via jsDelivr.

### Frontend regression check

Run `npm install --prefix local_data/qa --no-audit --no-fund linkedom@0.18.12`, then `node tests/library-ui.cjs` from the repository root. This isolated DOM test uses in-memory accounts, albums, and scan events; it does not contact Supabase or alter the physical reader. It covers grouping, search, selection, paging, favorites and save failure, add/delete, linked scans, and unknown-tag enrollment. Visual WebGL and fresh physical scans require browser/hardware checks.

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

### Pair a USB reader with the live website

1. Run [supabase/reader-pairing.sql](supabase/reader-pairing.sql) once in the project's Supabase SQL Editor. This adds a separate reader table, owner-only row policies, restricted response-column permissions, and a token-checked device RPC. It does not change existing album/tag tables.
2. Sign in on the GitHub Pages site. Open **Account → My readers → Pair a reader**. Give it a recognizable name and copy the credential shown once. Never commit or share that credential.
3. Stop the existing USB bridge. Run `python local_bridge.py --serial COM3 --pair --cloud` from this repository. Paste the credential at the hidden prompt. It is stored in ignored `local_data/reader-credential.json`, not in firmware or shell arguments.
4. Keep the live website open and signed in. A scan travels from ESP32 → USB bridge → Supabase → your account's website. The website resolves the tag using its existing account-scoped library, selects the album, and sends its display data back to the same reader. New tags open the existing Add CD workflow; saving the CD also updates the waiting reader.
5. Subsequent starts use `python local_bridge.py --serial COM3 --cloud`. Use **My readers → Revoke** to disable a credential immediately, then pair again if needed.

The USB relay is still useful as a fallback and for diagnostics. After applying `reader-direct.sql`, its paired reader also resolves CDs without an open website; the direct firmware above removes the need for the USB computer. The website stays on GitHub Pages and never needs permission to reach localhost. The indicator becomes offline after 15 seconds without a heartbeat. Only the latest scan per reader is retained. Scans older than 30 seconds are not replayed into the UI when the page opens. Internet failures retain the latest pending scan in the running bridge for retry; process restarts do not replay it.

The database stores only a SHA-256 hash of a random 256-bit reader credential. The credential permits only this reader's heartbeat, scan submission, and display response retrieval, not account sign-in or library browsing. Owners can read and revoke only their own reader records. Protect the local credential file like a password. Security approach follows [Supabase's function permissions guidance](https://supabase.com/docs/guides/database/functions).

Run `python tests/test_cloud_reader.py` for relay retry, response, and stale-scan checks; the existing `node tests/library-ui.cjs` checks UI scan selection and enrollment with simulated events. Live database access policies and a real paired sticker scan must also be verified after applying the migration.

The local bridge reads the `Tag detected. UID: ...` lines from the ESP32, saves scans and CDs in a local SQLite database, and serves this website at `http://127.0.0.1:8317/`. A new tag opens the Add CD flow in the website; after saving, another scan brings up the linked album in the website's scan panel and on the ESP32 screen. The tag stores only its factory UID; album information is stored in the database.

1. Upload `nfc_library/nfc_library.ino` to the ESP32. It uses Adafruit PN532, ArduinoJson, TFT_eSPI, and TJpg_Decoder. Keep the same PN532 wiring described above. This board's TFT_eSPI setup must use its display pins on **HSPI** (`USE_HSPI_PORT`), leaving the NFC reader on VSPI. The sketch temporarily replaces the music-display sketch while you test the CD library.
2. Keep the ESP32 connected by USB. Close Arduino Serial Monitor, which otherwise holds the COM port.
3. Install the bridge's serial and image libraries once: `python -m pip install -r requirements.txt`.
4. Run `python local_bridge.py --serial COM3` from the repository folder. Replace `COM3` if Arduino IDE shows a different port.
5. Open `http://127.0.0.1:8317/` on **this computer**. Use the small NFC indicator in the header to view connection details.
6. Scan a sticker. Search for its album and artist, select the correct CD edition, and save. Scan it again to see the saved CD in the NFC panel and a jewel case style view with album art, title, artist, and track count on the ESP32.

The bridge obtains cover art from the Cover Art Archive, resizes it to 160 × 160 pixels, and caches it in ignored `local_data/covers/`. It sends the image and a short lookup result to the ESP32 over USB serial. The ESP32 does not need Wi-Fi or secrets for this mode. If an album has no available cover or the art service is offline, the screen shows a disc placeholder. The bridge listens on localhost only and has no account or remote access. Its database is in ignored `local_data/`. The GitHub Pages site uses the same Supabase account library but cannot access this localhost USB reader directly.

Keep `secrets.h` private. Git ignores it, but verify staged files before pushing. The sketch currently uses `WiFiClientSecure::setInsecure()` for HTTPS requests, which skips certificate validation. This is suitable only for testing; a network attacker could intercept the Last.fm API key or alter responses.
