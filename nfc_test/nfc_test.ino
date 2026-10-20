#include <SPI.h>
#include <Adafruit_PN532.h>

// Pins printed beside the SPI connector on this ESP32 display variant.
constexpr uint8_t NFC_SCK = 18;
constexpr uint8_t NFC_MISO = 19;
constexpr uint8_t NFC_MOSI = 23;
constexpr uint8_t NFC_CS = 27;

Adafruit_PN532 nfc(NFC_CS, &SPI);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("PN532 NFC test starting...");

  SPI.begin(NFC_SCK, NFC_MISO, NFC_MOSI, NFC_CS);
  nfc.begin();

  const uint32_t firmware = nfc.getFirmwareVersion();
  if (!firmware) {
    Serial.println("PN532 not found. Check SPI mode, VCC/GND, and all four SPI wires.");
    while (true) delay(1000);
  }

  Serial.print("PN532 found. Firmware ");
  Serial.print((firmware >> 16) & 0xFF);
  Serial.print('.');
  Serial.println((firmware >> 8) & 0xFF);

  if (!nfc.SAMConfig()) {
    Serial.println("PN532 setup failed. Check the wiring and restart the ESP32.");
    while (true) delay(1000);
  }

  Serial.println("Ready. Hold an NFC card or sticker near the red antenna board.");
}

void loop() {
  uint8_t uid[7];
  uint8_t uidLength = 0;

  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 500)) {
    Serial.print("Tag detected. UID: ");
    for (uint8_t i = 0; i < uidLength; ++i) {
      if (uid[i] < 0x10) Serial.print('0');
      Serial.print(uid[i], HEX);
      if (i + 1 < uidLength) Serial.print(':');
    }
    Serial.println();
    delay(700);
  }
}
