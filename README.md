# ⏰ ChronoSync BLE Smart Alarm (Offline Web Controller)

A state-of-the-art, **Offline-Ready Web Bluetooth (BLE)** Smart Alarm Controller designed for modern browsers, mobile devices, and ESP32/Arduino hardware.

---

## 🌟 Key Features (विशेषताएं)

1. **⚡ Offline Access (PWA & Service Worker)**:
   - Works 100% without an active internet connection.
   - Powered by `sw.js` cache-first architecture.
   - Installable on Mobile (Android / iOS) & Desktop as a standalone app.

2. **📡 Web Bluetooth API (Connect Device with BLE)**:
   - Connect directly to ESP32 / Arduino / BLE hardware with a single click.
   - Standard Nordic UART Service UUIDs (`6E400001-...`).
   - Bidirectional communication: send alarms, receive battery/telemetry status.
   - **Virtual BLE Simulator**: Test all alarm triggers and buzzer audio right inside your browser without needing physical hardware!

3. **🔒 Hidden Device Details (Clean & Minimalist)**:
   - Raw technical details (Battery level %, RSSI signal strength, GATT UUID, Live communication packet logs) are **hidden by default** to keep the dashboard clean.
   - Click **"Device Details ▼"** anytime to smoothly expand the telemetry accordion.

4. **📺 Display Mode & Live OLED Clock**:
   - Synchronized digital OLED clock simulation.
   - 4 Gorgeous visual themes:
     - **Cyber Neon** (Cyan & Electric Blue)
     - **Amber Matrix** (Retro warm matrix)
     - **Emerald OLED** (Sleek minimalist green)
     - **Night Stealth** (Subtle red nightstand mode)
   - 12-Hour / 24-Hour toggle & hardware screen brightness slider.
   - Hardware RTC synchronization button (`Sync Time`).

5. **🚨 Rapid Buzzer Engine (Jaldi-Jaldi On/Off) & Alarm Dismiss Option**:
   - **Alarm Aane par**:
     - **Buzzer Jaldi-Jaldi On-Off**: Synthesized high-frequency piezo sound toggles rapidly (~100ms ON / ~90ms OFF) using the Web Audio API.
     - **Hardware Signal**: Sends `BUZZER:ON:RAPID` command over BLE to buzz the physical ESP32 buzzer.
     - **Vibration**: Mobile vibration pattern `[100, 80, 100, 80]`.
     - **Visual Alert**: Full-screen emergency strobe modal with pulsating visualizer.
   - **Off Krne Ka Option**:
     - Large tactile **"OFF ALARM / BUZZER SHUT"** button immediately silences the buzzer, halts vibration, and sends `BUZZER:OFF` command over BLE.
     - **Snooze Button**: Temporarily snoozes alarm for 5/10/15 minutes.

---

## 🚀 How to Run Locally (Local Server Start)

Because modern browsers require a **Secure Context** (`http://localhost:*` or `https://*`) for Web Bluetooth and Service Workers, run the included PowerShell server script:

### Method 1: Using PowerShell (Recommended)
1. Open PowerShell in this folder:
   ```powershell
   cd d:\files\SMART_ALARM
   .\start_server.ps1
   ```
2. It will automatically start the server at `http://localhost:8080/` and open your default browser.

---

## 📱 Mobile & Offline Installation (PWA)
1. Open `http://localhost:8080/` (or host it on GitHub Pages / Vercel with HTTPS).
2. On Android Chrome: Tap the 3 dots menu -> **"Install app"** or **"Add to Home screen"**.
3. It will work completely offline even in Airplane mode!

---

## 🔌 Hardware Setup (ESP32 + Buzzer Wiring)

| ESP32 Pin | Buzzer / Component | Description |
|-----------|--------------------|-------------|
| **GPIO 18** | Buzzer Positive (+) | Triggers rapid on-off pulsing signal |
| **GND** | Buzzer Negative (-) | Common Ground |
| **GPIO 2** | Built-in LED | Illuminates when BLE is connected / alarm active |

### Flashing Firmware:
1. Open Arduino IDE.
2. Open [`esp32_smart_alarm/arduino_esp32_smart_alarm.ino`](file:///d:/files/SMART_ALARM/esp32_smart_alarm/arduino_esp32_smart_alarm.ino).
3. Select Board: **ESP32 Dev Module**.
4. Click **Upload**.
5. Click **"Connect Device via BLE"** in the web dashboard!

---

## 🧪 Testing Without Hardware (Simulator Mode)
1. Open the dashboard.
2. Click **"Virtual Simulator"**.
3. Click **"Test Buzzer (3s)"** to test the rapid beeping sound.
4. Click **"⚡ Trigger Alarm Simulation Now"** at the bottom to test the full-screen emergency strobe modal and the **"OFF ALARM"** dismiss button!
