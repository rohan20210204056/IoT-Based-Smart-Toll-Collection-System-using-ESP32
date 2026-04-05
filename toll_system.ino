#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// RC522 RFID Reader
#define RFID_RST_PIN    22   // D22 → RST
#define RFID_SS_PIN      5   // D5  → SDA/SS
// SPI Bus:  SCK → D18 | MISO → D19 | MOSI → D23

// FC51 IR Sensors (Active LOW: LOW = object detected)
#define IR_SENSOR_1     34   // Entry sensor
#define IR_SENSOR_2     35   // Exit sensor

// Servo Motor
#define SERVO_PIN       13

// Buzzer
#define BUZZER_PIN      12

// OLED Display
#define OLED_SDA        26   // OLED SDA → GPIO26
#define OLED_SCL        25   // OLED SCL → GPIO25

const char* WIFI_SSID       = "Galaxy";
const char* WIFI_PASSWORD   = "qwerty123a";

const char* APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz5OmF1I5ts97C767yb6Igcmh3JW0zDbiCsGAN5LvD72YdpQxF_0G-EmtEdLjMknxpRBA/exec";

const int   GATE_OPEN_ANGLE  =  0;
const int   GATE_CLOSE_ANGLE =  90;
const unsigned long GATE_OPEN_DURATION = 6000;

MFRC522          rfid(RFID_SS_PIN, RFID_RST_PIN);
Servo            gateServo;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

bool          gateOpen       = false;
unsigned long gateOpenedAt   = 0;
unsigned long lastScanMillis = 0;
const unsigned long SCAN_DEBOUNCE_MS = 3000;

void oledScanning(String cardId) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.fillRect(0, 0, 128, 13, SSD1306_WHITE);
  oled.setTextColor(SSD1306_BLACK);
  oled.setTextSize(1);
  oled.setCursor(22, 3);
  oled.print("SCANNING CARD...");
  oled.setTextColor(SSD1306_WHITE);

  oled.setTextSize(1);
  oled.setCursor(0, 18);
  oled.print("Card ID:");
  oled.setCursor(0, 28);
  oled.print(cardId);

  oled.setCursor(0, 45);
  oled.print("Please wait...");

  oled.display();
}

void oledResult(String name, String vehicle, String status,
                int toll, int balance) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.fillRect(0, 0, 128, 13, SSD1306_WHITE);
  oled.setTextColor(SSD1306_BLACK);
  oled.setTextSize(1);
  oled.setCursor(2, 3);
  oled.print(status);   // "TOLL PAID OK!" or "LOW BALANCE! print korbe"
  oled.setTextColor(SSD1306_WHITE);

  oled.setTextSize(1);
  oled.setCursor(0, 17);
  oled.print("Name   : "); oled.print(name);

  oled.setCursor(0, 27);
  oled.print("Vehicle: "); oled.print(vehicle);

  oled.drawLine(0, 38, 128, 38, SSD1306_WHITE);

  oled.setCursor(0, 42);
  oled.print("Toll   : BDT "); oled.print(toll);

  oled.setCursor(0, 52);
  oled.print("Balance: BDT "); oled.print(balance);

  oled.display();
}

void oledNotFound(String cardId) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.fillRect(0, 0, 128, 13, SSD1306_WHITE);
  oled.setTextColor(SSD1306_BLACK);
  oled.setTextSize(1);
  oled.setCursor(16, 3);
  oled.print("CARD NOT FOUND!");
  oled.setTextColor(SSD1306_WHITE);

  oled.setCursor(0, 18);
  oled.print("Card ID:");
  oled.setCursor(0, 28);
  oled.print(cardId);

  oled.drawLine(0, 40, 128, 40, SSD1306_WHITE);

  oled.setCursor(0, 44);
  oled.print("Not registered.");
  oled.setCursor(0, 54);
  oled.print("Contact admin.");

  oled.display();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=================================================="));
  Serial.println(F("|   SMART TOLL SYSTEM  —  ESP32    |"));
  Serial.println(F("=================================================="));
  
  Wire.begin(OLED_SDA, OLED_SCL);
  if (oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    oled.clearDisplay();
    oled.setTextWrap(false);
    Serial.println(F("[OLED]   OK"));
  } else {
    Serial.println(F("[OLED]   Not found — check wiring"));
  }
  
  pinMode(IR_SENSOR_1, INPUT);
  pinMode(IR_SENSOR_2, INPUT);
  pinMode(BUZZER_PIN,  OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  gateServo.attach(SERVO_PIN);
  closeGate();
  Serial.println(F("[SERVO]  Gate initialised — CLOSED"));

  SPI.begin(18, 19, 23, 5);
  rfid.PCD_Init();
  delay(50);
  Serial.print(F("[RFID]   Reader version: "));
  rfid.PCD_DumpVersionToSerial();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print(F("[WiFi]   Connecting"));
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print('.');
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi]   Connected — IP: " + WiFi.localIP().toString());
    beep(1, 300);
  } else {
    Serial.println(F("\n[WiFi]   FAILED — running in offline mode"));
    beep(5, 100);
  }

  Serial.println(F("[SYS]    System ready\n"));
}

void loop() {
  bool ir1 = (digitalRead(IR_SENSOR_1) == LOW);
  bool ir2 = (digitalRead(IR_SENSOR_2) == LOW);

  if (gateOpen) {
    bool vehicleCleared = (ir2 && !ir1);
    bool timedOut       = (millis() - gateOpenedAt > GATE_OPEN_DURATION);
    if (vehicleCleared || timedOut) {
      delay(800);
      closeGate();
    }
    return;
  }

  if (!ir1 && ir2) return;

  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial())   return;

  if (millis() - lastScanMillis < SCAN_DEBOUNCE_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }
  lastScanMillis = millis();

  String cardId = readCardUID();
  Serial.println("\n[RFID]   Scanned: " + cardId);

  oledScanning(cardId);

  if (ir1) {
    Serial.println(F("[MODE]   Toll payment"));
    processPayment(cardId);
  } else {
    Serial.println(F("[MODE]   Query scan"));
    queryScan(cardId);
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  rfid.PCD_Init();
}

String readCardUID() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

void processPayment(String cardId) {
  StaticJsonDocument<256> req;
  req["action"] = "deductToll";
  req["cardId"] = cardId;
  String body;
  serializeJson(req, body);

  String response = httpPost(body);
  if (response.isEmpty()) {
    Serial.println(F("[PAY]    No server response"));
    beep(2, 300);
    return;
  }

  StaticJsonDocument<512> res;
  if (deserializeJson(res, response) != DeserializationError::Ok) {
    Serial.println(F("[PAY]    JSON parse error"));
    return;
  }

  const char* status      = res["status"]      | "error";
  const char* name        = res["name"]        | "Unknown";
  const char* vehicleType = res["vehicleType"] | "Unknown";

  Serial.print("[PAY]    Status: "); Serial.println(status);

  if (strcmp(status, "success") == 0) {
    int toll    = res["toll"].as<int>();
    int newBal  = res["newBalance"].as<int>();
    Serial.printf("[PAY]    Toll: %d tk | Balance: %d tk\n", toll, newBal);

    oledResult(name, vehicleType, "  TOLL PAID OK!  ", toll, newBal);
    openGate();
    beepLong(3000);

  } else if (strcmp(status, "insufficient") == 0) {
    int bal  = res["balance"].as<int>();
    int need = res["required"].as<int>();
    Serial.printf("[PAY]    Insufficient! Has: %d tk | Needs: %d tk\n", bal, need);

    oledResult(name, vehicleType, "  LOW BALANCE!   ", need, bal);
    beep(3, 200);

  } else if (strcmp(status, "not_found") == 0) {
    Serial.println(F("[PAY]    Card not registered!"));

    oledNotFound(cardId);
    beep(5, 100);
  }
}

void queryScan(String cardId) {
  StaticJsonDocument<256> req;
  req["action"] = "queryScan";
  req["cardId"] = cardId;
  String body;
  serializeJson(req, body);

  String response = httpPost(body);
  Serial.println("[QUERY]  Response: " + response);
  beep(1, 100);

  StaticJsonDocument<512> res;
  if (!response.isEmpty() &&
      deserializeJson(res, response) == DeserializationError::Ok &&
      strcmp((res["status"] | ""), "success") == 0) {

    const char* name  = res["card"]["name"]        | "Unknown";
    const char* vtype = res["card"]["vehicleType"] | "Unknown";
    int         bal   = res["card"]["balance"]      | 0;
    int         toll  = (strcmp(vtype, "bus") == 0) ? 200 : 100;

    oledResult(name, vtype, "   QUERY SCAN    ", toll, bal);

  } else {
    oledNotFound(cardId);
  }
}

String httpPost(const String& body) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP]   WiFi disconnected — skipping request"));
    return "";
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, APPS_SCRIPT_URL);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(12000);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  String resp = "";

  if (code > 0) {
    resp = http.getString();
    Serial.print("[HTTP]   Code: "); Serial.println(code);
  } else {
    Serial.print("[HTTP]   Error: "); Serial.println(http.errorToString(code));
  }

  http.end();
  return resp;
}

void openGate() {
  gateServo.write(GATE_OPEN_ANGLE);
  gateOpen     = true;
  gateOpenedAt = millis();
  Serial.println(F("[GATE]   ▲ OPENED"));
}

void closeGate() {
  gateServo.write(GATE_CLOSE_ANGLE);
  gateOpen = false;
  Serial.println(F("[GATE]   ▼ CLOSED"));
}

void beep(int times, int durationMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(150);
  }
}

void beepLong(int durationMs) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(durationMs);
  digitalWrite(BUZZER_PIN, LOW);
}
