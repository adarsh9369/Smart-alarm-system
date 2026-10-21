/*
 * =========================================================================================
 * CHRONOSYNC SMART ALARM - COMPLETE ESP32 / XIAO ESP32-C3 BLE FIRMWARE
 * =========================================================================================
 * Board: Works with XIAO ESP32-C3 and Standard ESP32 (DevKit / NodeMCU)
 *
 * Hardware Components:
 * - Microcontroller: XIAO ESP32-C3 or standard ESP32
 * - Buzzer: Connected to D3 (GPIO 5 on Xiao, GPIO 18 on DevKit)
 * - LED: Connected to D0 (GPIO 2 on Xiao, GPIO 2 on DevKit)
 * - OLED Display: SH1106G / SSD1306 I2C (SDA = D4/GPIO 21, SCL = D5/GPIO 22)
 * - RTC Module: DS3231 I2C (Automatic fallback to internal RTC if not present)
 *
 * Features:
 * 1. Bluetooth Low Energy (BLE) Nordic UART server ("ChronoSync_Alarm_BLE").
 * 2. Instant time synchronization from Phone/PC Webpage over BLE.
 * 3. Rapid Jaldi-Jaldi Buzzer Pulsing (100ms ON / 90ms OFF) when alarm triggers.
 * 4. Remote Buzzer OFF command directly from the web page.
 * 5. Persistent EEPROM/Preferences storage (alarms saved across power loss).
 * =========================================================================================
 */

#include <Wire.h>
#include <RTClib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---------------- Pin Configuration ----------------
#if defined(ARDUINO_XIAO_ESP32C3) || defined(ARDUINO_SEEED_XIAO_ESP32C3)
  #define BUZZER_PIN D3  // GPIO 5
  #define LED_PIN    D0  // GPIO 2
  #define OLED_SDA   D4  // GPIO 6
  #define OLED_SCL   D5  // GPIO 7
#else
  // Standard ESP32
  #define BUZZER_PIN 18  // Change to match your wiring
  #define LED_PIN    2   // Onboard Blue LED
  #define OLED_SDA   21
  #define OLED_SCL   22
#endif

// ---------------- BLE UUIDs ----------------
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// ---------------- Objects ----------------
Adafruit_SH1106G display(128, 64, &Wire, -1);
RTC_DS3231 rtc;
Preferences prefs;
BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;

// ---------------- State Variables ----------------
bool bleConnected = false;
bool rtcFound = false;
bool oledFound = false;

// Display mode: 0=Time Only, 1=Time+Date, 2=Full Details
int displayMode = 1;

// Alarm State
int alarmHour = 7;
int alarmMinute = 0;
bool alarmEnabled = true;
bool alarmRinging = false;
String alarmPattern = "RAPID";

// Jaldi-Jaldi Rapid Buzzer Timing
unsigned long ringStarted = 0;
const unsigned long ALARM_RING_TIMEOUT = 60000; // Auto-stop after 60s
unsigned long lastBuzzerRapid = 0;
bool buzzerRapidState = false;

int lastAlarmYear = -1;
int lastAlarmMonth = -1;
int lastAlarmDay = -1;

unsigned long lastOLEDUpdate = 0;
volatile bool timeSyncDisplayRefresh = false;

// Internal software clock if hardware RTC is not connected
unsigned long internalEpoch = 0;
unsigned long epochSyncMillis = 0;

// ---------------- Helpers ----------------
String two(int n) {
  return n < 10 ? "0" + String(n) : String(n);
}

DateTime getCurrentTime() {
  if (rtcFound) {
    return rtc.now();
  } else {
    // Software RTC calculation
    unsigned long currentSec = internalEpoch + ((millis() - epochSyncMillis) / 1000);
    return DateTime((uint32_t)currentSec);
  }
}

void notifyWebClient(String msg) {
  if (bleConnected && pTxCharacteristic != NULL) {
    msg += "\n";
    pTxCharacteristic->setValue(msg.c_str());
    pTxCharacteristic->notify();
  }
}

// ---------------- BLE Command Parser ----------------
void drawOLED(DateTime t); // Forward declaration

void processBleCommand(String cmd) {
  cmd.trim();
  Serial.print("[BLE COMMAND] ");
  Serial.println(cmd);

  // 1. BUZZER OFF (Vha se off krna ka option)
  if (cmd.startsWith("BUZZER:OFF")) {
    alarmRinging = false;
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    Serial.println(">> ALARM / BUZZER SHUT OFF VIA BLE");
    notifyWebClient("BUZZER:OFF:ACK");
  }
  // 2. BUZZER ON / MANUAL TEST
  else if (cmd.startsWith("BUZZER:ON")) {
    alarmRinging = true;
    ringStarted = millis();
    if (cmd.indexOf("RAPID") >= 0) alarmPattern = "RAPID";
    else if (cmd.indexOf("DOUBLE") >= 0) alarmPattern = "DOUBLE";
    else if (cmd.indexOf("CONTINUOUS") >= 0) alarmPattern = "CONTINUOUS";
    else alarmPattern = "RAPID";
    Serial.println(">> BUZZER TRIGGERED: Rapid Mode Active");
    notifyWebClient("BUZZER:ON:ACK");
  }
  // 3. TIME SYNC FROM BROWSER (local date/time; no Wi-Fi required)
  else if (cmd.startsWith("SYNC_TIME:")) {
    // Preferred format: SYNC_TIME:YYYY-MM-DDTHH:MM:SS
    // The browser sends local wall-clock time so the RTC displays the same local time.
    String dateTimeStr = cmd.substring(10);
    dateTimeStr.trim();

    // Accept both the preferred local ISO format and legacy Unix timestamp format.
    // ISO: YYYY-MM-DDTHH:MM:SS | Legacy: 1792584257:17:34:17 (epoch:HH:MM:SS)
    DateTime syncedTime(2000, 1, 1, 0, 0, 0);
    bool parsedTime = false;

    if (dateTimeStr.length() == 19 &&
        dateTimeStr.charAt(4) == '-' &&
        dateTimeStr.charAt(7) == '-' &&
        dateTimeStr.charAt(10) == 'T' &&
        dateTimeStr.charAt(13) == ':' &&
        dateTimeStr.charAt(16) == ':') {
      int year = dateTimeStr.substring(0, 4).toInt();
      int month = dateTimeStr.substring(5, 7).toInt();
      int day = dateTimeStr.substring(8, 10).toInt();
      int hour = dateTimeStr.substring(11, 13).toInt();
      int minute = dateTimeStr.substring(14, 16).toInt();
      int second = dateTimeStr.substring(17, 19).toInt();
      if (year >= 2024 && year <= 2099 &&
          month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
          hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 &&
          second >= 0 && second <= 59) {
        syncedTime = DateTime(year, month, day, hour, minute, second);
        parsedTime = syncedTime.isValid();
      }
    } else {
      // Backward compatibility for webpage versions sending epoch:HH:MM:SS.
      int firstColon = dateTimeStr.indexOf(':');
      if (firstColon > 0) {
        uint32_t epoch = (uint32_t)dateTimeStr.substring(0, firstColon).toInt();
        // Legacy webpage sends Unix epoch (UTC) followed by browser-local HH:MM:SS.
        // This alarm is used in India, so convert UTC epoch to IST (UTC+05:30).
        DateTime epochTime(epoch + 19800UL);
        if (epoch >= 1700000000UL && epochTime.year() >= 2024 && epochTime.year() <= 2099) {
          syncedTime = DateTime(epochTime.year(), epochTime.month(), epochTime.day(),
                                epochTime.hour(), epochTime.minute(), epochTime.second());
          // Prefer the explicit browser-local time fields when present.
          int p2 = dateTimeStr.indexOf(':', firstColon + 1);
          int p3 = dateTimeStr.indexOf(':', p2 + 1);
          if (p2 > 0 && p3 > 0) {
            int localHour = dateTimeStr.substring(firstColon + 1, p2).toInt();
            int localMinute = dateTimeStr.substring(p2 + 1, p3).toInt();
            int localSecond = dateTimeStr.substring(p3 + 1).toInt();
            if (localHour >= 0 && localHour <= 23 && localMinute >= 0 && localMinute <= 59 &&
                localSecond >= 0 && localSecond <= 59) {
              syncedTime = DateTime(epochTime.year(), epochTime.month(), epochTime.day(),
                                    localHour, localMinute, localSecond);
            }
          }
          parsedTime = true;
          Serial.println(">> Legacy epoch time format accepted (IST/local time).");
        }
      }
    }

    if (parsedTime && syncedTime.isValid() &&
        syncedTime.year() >= 2024 &&
        syncedTime.year() <= 2099) {
      // Update both clocks, then verify the hardware RTC actually accepted it.
      // OLED drawing is kept in loop() to avoid concurrent I2C access from the BLE task.
      internalEpoch = syncedTime.unixtime();
      epochSyncMillis = millis();

      if (rtcFound) {
        rtc.adjust(syncedTime);
        delay(5);
        DateTime rtcReadBack = rtc.now();
        Serial.print(">> RTC read-back after BLE sync: ");
        Serial.println(rtcReadBack.timestamp());
        if (rtcReadBack.unixtime() < syncedTime.unixtime() ||
            rtcReadBack.unixtime() > syncedTime.unixtime() + 2) {
          Serial.println(">> WARNING: RTC read-back does not match synced time.");
        }
      }

      timeSyncDisplayRefresh = true;
      Serial.print(">> Local date/time synced over BLE: ");
      Serial.println(syncedTime.timestamp());
      notifyWebClient("TIME:SYNCED:OK");
    } else {
      Serial.print(">> Invalid SYNC_TIME format: ");
      Serial.println(dateTimeStr);
      notifyWebClient("TIME:SYNCED:ERROR");
    }
  }
  // 4. SET ALARM
  else if (cmd.startsWith("SET_ALM:")) {
    // Format: SET_ALM:<id>:<HH:MM>:<Days>:<Pattern>
    int p1 = cmd.indexOf(':');
    int p2 = cmd.indexOf(':', p1 + 1);
    int p3 = cmd.indexOf(':', p2 + 1);
    
    if (p2 > 0 && p3 > 0) {
      String timePart = cmd.substring(p2 + 1, p3);
      int colonTime = timePart.indexOf(':');
      if (colonTime > 0) {
        alarmHour = timePart.substring(0, colonTime).toInt();
        alarmMinute = timePart.substring(colonTime + 1).toInt();
        alarmEnabled = true;

        // Save to preferences
        prefs.putInt("alm_h", alarmHour);
        prefs.putInt("alm_m", alarmMinute);
        prefs.putBool("alm_en", alarmEnabled);

        Serial.printf(">> New Alarm Saved: %02d:%02d\n", alarmHour, alarmMinute);
        notifyWebClient("ALARM:SAVED:" + timePart);
      }
    }
  }
  // 5. TOGGLE ALARM
  else if (cmd.startsWith("TOGGLE_ALM:")) {
    int p = cmd.lastIndexOf(':');
    if (p > 0) {
      alarmEnabled = (cmd.substring(p + 1).toInt() == 1);
      prefs.putBool("alm_en", alarmEnabled);
      Serial.printf(">> Alarm Enabled State: %d\n", alarmEnabled);
    }
  }
  // 6. DISPLAY THEME & BRIGHTNESS
  else if (cmd.startsWith("SET_BRIGHT:")) {
    int b = cmd.substring(11).toInt();
    if (oledFound) {
      display.setContrast(map(b, 0, 100, 0, 255));
    }
  }
}

// ---------------- BLE Callbacks ----------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleConnected = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("[BLE] Web Dashboard Connected!");
  };

  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("[BLE] Client Disconnected. Re-advertising...");
    BLEDevice::startAdvertising();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String rxStr = String(pCharacteristic->getValue().c_str());
    if (rxStr.length() > 0) {
      processBleCommand(rxStr);
    }
  }
};

// ---------------- OLED Screen Drawing ----------------
void drawOLED(DateTime t) {
  if (!oledFound) return;

  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);

  // Top row: show only alarm enabled state. Do not show BLE connection status.
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("ALARM: ");
  display.print(alarmEnabled ? "ON" : "OFF");

  // Main clock: larger and visually bolder HH:MM.
  int h = t.hour();
  const int m = t.minute();
  String ampm = (h >= 12) ? "PM" : "AM";
  h = h % 12;
  if (h == 0) h = 12;

  String timeText = two(h) + ":" + two(m);
  display.setTextSize(3);
  // Slight overprint makes the built-in font appear bolder.
  display.setCursor(19, 17);
  display.print(timeText);
  display.setCursor(20, 17);
  display.print(timeText);

  // Short date + weekday on the bottom row.
  static const char *shortDays[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
  static const char *shortMonths[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                                      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
  display.setTextSize(1);
  display.setCursor(25, 53);
  display.print(shortDays[t.dayOfTheWeek()]);
  display.print(" ");
  display.printf("%02d %s", t.day(), shortMonths[t.month() - 1]);
  display.setCursor(103, 0);
  display.print(ampm);

  display.display();
}

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- ChronoSync Smart Alarm ESP32 BLE Starting ---");

  // Output Pins
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  // Preferences (Saved alarms)
  prefs.begin("chrono_alm", false);
  alarmHour = prefs.getInt("alm_h", 7);
  alarmMinute = prefs.getInt("alm_m", 0);
  alarmEnabled = prefs.getBool("alm_en", true);

  // I2C
  Wire.begin(OLED_SDA, OLED_SCL);

  // OLED Init
  if (display.begin(0x3C, true)) {
    oledFound = true;
    display.clearDisplay();
    display.setTextColor(SH110X_WHITE);
    display.setTextSize(1);
    display.setCursor(10, 20);
    display.println("ChronoSync BLE");
    display.setCursor(10, 36);
    display.println("Smart Alarm Ready");
    display.display();
    delay(1000);
  } else {
    Serial.println("Note: OLED SH1106 not detected on 0x3C.");
  }

  // RTC Init
  if (rtc.begin()) {
    rtcFound = true;
    Serial.println("RTC DS3231 Initialized successfully.");
    if (rtc.lostPower()) {
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  } else {
    Serial.println("Note: RTC DS3231 not found. Using internal software clock with BLE sync.");
    internalEpoch = 1700000000; // Baseline
    epochSyncMillis = millis();
  }

  // BLE Setup
  BLEDevice::init("ChronoSync_Alarm_BLE");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // TX Characteristic (Send updates to browser)
  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // RX Characteristic (Receive commands from browser)
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                           CHARACTERISTIC_UUID_RX,
                                           BLECharacteristic::PROPERTY_WRITE
                                         );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  pService->start();

  // Advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE Advertising started as 'ChronoSync_Alarm_BLE'");
  Serial.printf("Current Alarm: %02d:%02d (Enabled: %d)\n", alarmHour, alarmMinute, alarmEnabled);
}

// ---------------- Main Loop ----------------
void loop() {
  DateTime now = getCurrentTime();

  // After BLE sync, refresh immediately from the clock source and log what the OLED will show.
  if (timeSyncDisplayRefresh) {
    timeSyncDisplayRefresh = false;
    now = getCurrentTime();
    Serial.print(">> OLED refresh using time: ");
    Serial.println(now.timestamp());
    drawOLED(now);
    lastOLEDUpdate = millis();
  }

  // Trigger Daily Alarm when time matches
  if (alarmEnabled && !alarmRinging &&
      now.hour() == alarmHour &&
      now.minute() == alarmMinute &&
      now.second() == 0 &&
      (lastAlarmYear != now.year() ||
       lastAlarmMonth != now.month() ||
       lastAlarmDay != now.day())) {

    alarmRinging = true;
    ringStarted = millis();

    lastAlarmYear = now.year();
    lastAlarmMonth = now.month();
    lastAlarmDay = now.day();

    Serial.println(">>> ALARM TRIGGERED! Rapid Buzzer Ringing <<<");
    notifyWebClient("ALARM_TRIGGERED:NOW");
  }

  // ====================================================================
  // JALDI-JALDI RAPID BUZZER ENGINE (100ms ON / 90ms OFF)
  // ====================================================================
  if (alarmRinging) {
    unsigned long currentMillis = millis();

    if (alarmPattern == "RAPID") {
      // Jaldi-Jaldi On/Off: 100ms ON (Beep), 90ms OFF (Silence)
      unsigned long duration = buzzerRapidState ? 100 : 90;
      if (currentMillis - lastBuzzerRapid >= duration) {
        lastBuzzerRapid = currentMillis;
        buzzerRapidState = !buzzerRapidState;
        digitalWrite(BUZZER_PIN, buzzerRapidState ? HIGH : LOW);
        digitalWrite(LED_PIN, buzzerRapidState ? HIGH : LOW);
      }
    } 
    else if (alarmPattern == "DOUBLE") {
      // Double Beep
      static int subStep = 0;
      unsigned long intervals[] = {80, 80, 80, 350};
      if (currentMillis - lastBuzzerRapid >= intervals[subStep]) {
        lastBuzzerRapid = currentMillis;
        subStep = (subStep + 1) % 4;
        bool bState = (subStep == 0 || subStep == 2);
        digitalWrite(BUZZER_PIN, bState ? HIGH : LOW);
        digitalWrite(LED_PIN, bState ? HIGH : LOW);
      }
    }
    else {
      // Continuous
      digitalWrite(BUZZER_PIN, HIGH);
      digitalWrite(LED_PIN, HIGH);
    }

    // Auto-stop timeout (1 minute)
    if (currentMillis - ringStarted >= ALARM_RING_TIMEOUT) {
      alarmRinging = false;
      digitalWrite(BUZZER_PIN, LOW);
      digitalWrite(LED_PIN, LOW);
      Serial.println(">> Alarm auto-stopped after 60s timeout.");
    }
  } else {
    // When not ringing, ensure pins are completely OFF
    digitalWrite(BUZZER_PIN, LOW);
    if (!bleConnected) {
      digitalWrite(LED_PIN, LOW);
    }
  }

  // Refresh OLED Display every 250ms
  if (millis() - lastOLEDUpdate >= 250) {
    lastOLEDUpdate = millis();
    drawOLED(now);
  }

  delay(2);
}
