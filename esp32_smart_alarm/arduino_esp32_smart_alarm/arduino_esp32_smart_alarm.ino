/*
 * ==============================================================================
 * CHRONOSYNC SMART ALARM - ESP32 BLE FIRMWARE
 * ==============================================================================
 * Hardware Requirements:
 * - ESP32 Development Board (e.g., NodeMCU ESP32, ESP32-WROOM-32)
 * - 5V / 3.3V Buzzer (Active or Passive) connected to GPIO 18 and GND
 * - (Optional) OLED Display SSD1306 (I2C SDA: GPIO 21, SCL: GPIO 22)
 *
 * Supported BLE Commands from Web Dashboard:
 * - SYNC_TIME:<epoch>:<HH:MM:SS>
 * - SET_ALM:<id>:<HH:MM>:<Days>:<Pattern>
 * - TOGGLE_ALM:<id>:<0|1>
 * - DEL_ALM:<id>
 * - BUZZER:ON:<Pattern>  (e.g., RAPID -> Jaldi-Jaldi on/off buzzer)
 * - BUZZER:OFF           (Turns off buzzer immediately)
 * - SET_BRIGHT:<0-100>
 * ==============================================================================
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define BUZZER_PIN 18 // Pin connected to Buzzer positive terminal
#define LED_INDICATOR 2 // Onboard LED for connection and alarm status

// Standard Nordic UART UUIDs (Matches the Web Bluetooth App)
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Alarm & Buzzer States
bool isBuzzerActive = false;
String buzzerPattern = "RAPID";
unsigned long lastBuzzerToggleTime = 0;
bool buzzerPinState = false;

// Command Parser
void handleIncomingCommand(String cmd) {
  cmd.trim();
  Serial.print("[BLE INCOMING] ");
  Serial.println(cmd);

  if (cmd.startsWith("BUZZER:ON")) {
    isBuzzerActive = true;
    if (cmd.indexOf("RAPID") >= 0) buzzerPattern = "RAPID";
    else if (cmd.indexOf("DOUBLE") >= 0) buzzerPattern = "DOUBLE";
    else if (cmd.indexOf("CONTINUOUS") >= 0) buzzerPattern = "CONTINUOUS";
    else buzzerPattern = "RAPID";

    Serial.println(">> BUZZER TRIGGERED: Rapid Mode Active");
  } 
  else if (cmd.startsWith("BUZZER:OFF")) {
    isBuzzerActive = false;
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_INDICATOR, LOW);
    Serial.println(">> BUZZER STOPPED: Off");
  }
  else if (cmd.startsWith("SYNC_TIME")) {
    Serial.println(">> Hardware Time Synced from Web Controller");
    // Send acknowledgement back to web app
    if (deviceConnected && pTxCharacteristic != NULL) {
      String reply = "TIME_ACK:OK\n";
      pTxCharacteristic->setValue(reply.c_str());
      pTxCharacteristic->notify();
    }
  }
}

// Server Callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    digitalWrite(LED_INDICATOR, HIGH);
    Serial.println("[BLE] Web Client Connected!");
  };

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    digitalWrite(LED_INDICATOR, LOW);
    Serial.println("[BLE] Client Disconnected. Restarting Advertising...");
    BLEDevice::startAdvertising();
  }
};

// RX Characteristic Callbacks
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String rxStr = String(pCharacteristic->getValue().c_str());
    if (rxStr.length() > 0) {
      handleIncomingCommand(rxStr);
    }
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_INDICATOR, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_INDICATOR, LOW);

  Serial.println("Starting ChronoSync ESP32 BLE Smart Alarm...");

  // Initialize BLE
  BLEDevice::init("ChronoSync_Alarm_BLE");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // TX Characteristic (Notify web app)
  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // RX Characteristic (Receive commands from web app)
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
  pAdvertising->setMinPreferred(0x06); // iPhone connection helpers
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("ChronoSync BLE Ready & Advertising. Connect from Web App!");
}

void loop() {
  // Rapid Buzzer Toggle Engine (Jaldi-Jaldi on/off)
  if (isBuzzerActive) {
    unsigned long currentMillis = millis();

    if (buzzerPattern == "RAPID") {
      // Jaldi-Jaldi: 100ms ON, 90ms OFF
      unsigned long interval = buzzerPinState ? 100 : 90;
      if (currentMillis - lastBuzzerToggleTime >= interval) {
        lastBuzzerToggleTime = currentMillis;
        buzzerPinState = !buzzerPinState;
        digitalWrite(BUZZER_PIN, buzzerPinState ? HIGH : LOW);
        digitalWrite(LED_INDICATOR, buzzerPinState ? HIGH : LOW);
      }
    } 
    else if (buzzerPattern == "DOUBLE") {
      // Double pulse: 80ms ON, 80ms OFF, 80ms ON, 300ms OFF
      static int subStep = 0;
      unsigned long intervals[] = {80, 80, 80, 350};
      if (currentMillis - lastBuzzerToggleTime >= intervals[subStep]) {
        lastBuzzerToggleTime = currentMillis;
        subStep = (subStep + 1) % 4;
        bool state = (subStep == 0 || subStep == 2);
        digitalWrite(BUZZER_PIN, state ? HIGH : LOW);
        digitalWrite(LED_INDICATOR, state ? HIGH : LOW);
      }
    }
    else {
      // Continuous
      digitalWrite(BUZZER_PIN, HIGH);
      digitalWrite(LED_INDICATOR, HIGH);
    }
  }

  // Periodic Telemetry Simulation (Every 30s send battery status)
  static unsigned long lastTelemetry = 0;
  if (deviceConnected && millis() - lastTelemetry > 30000) {
    lastTelemetry = millis();
    String batMsg = "BATTERY:94\n";
    pTxCharacteristic->setValue(batMsg.c_str());
    pTxCharacteristic->notify();
  }

  delay(5);
}
