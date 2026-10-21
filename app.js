/**
 * CHRONOSYNC BLE SMART ALARM
 * Modern Web Bluetooth Controller & Synthesized Rapid Buzzer Engine
 * Works 100% Offline with Service Worker
 */

// Configuration & Standard Nordic UART BLE UUIDs
const BLE_CONFIG = {
  serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rxCharUuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Write to hardware
  txCharUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'  // Read / Notify from hardware
};

// Application State
const state = {
  isBleConnected: false,
  isSimulator: false,
  bleDevice: null,
  rxCharacteristic: null,
  txCharacteristic: null,
  timeFormat24h: false,
  currentTheme: 'neon',
  brightness: 85,
  alarms: [],
  activeAlarmTriggered: null,
  isDetailsVisible: false,
  snoozeDurationMin: 10,
  audioCtx: null,
  buzzerOscillator: null,
  buzzerGain: null,
  buzzerIntervalId: null,
  vibrationIntervalId: null,
  lastTriggeredMinute: null
};

// DOM Elements
const elements = {
  // Badges & Status
  offlineBadge: document.getElementById('offlineBadge'),
  offlineStatusText: document.getElementById('offlineStatusText'),
  bleStatusPill: document.getElementById('bleStatusPill'),
  bleStatusText: document.getElementById('bleStatusText'),
  
  // Connection Hub
  deviceAvatarIcon: document.getElementById('deviceAvatarIcon'),
  connectedDeviceName: document.getElementById('connectedDeviceName'),
  connectedDeviceStatus: document.getElementById('connectedDeviceStatus'),
  btnConnectBle: document.getElementById('btnConnectBle'),
  btnDisconnectBle: document.getElementById('btnDisconnectBle'),
  btnSimulateBle: document.getElementById('btnSimulateBle'),
  simulateBtnText: document.getElementById('simulateBtnText'),
  btnToggleDetails: document.getElementById('btnToggleDetails'),
  hiddenDeviceDetails: document.getElementById('hiddenDeviceDetails'),
  
  // Telemetry
  telBattery: document.getElementById('telBattery'),
  telBatteryBar: document.getElementById('telBatteryBar'),
  telRssi: document.getElementById('telRssi'),
  bleLogConsole: document.getElementById('bleLogConsole'),
  btnClearLogs: document.getElementById('btnClearLogs'),

  // OLED Screen
  oledDisplayContainer: document.getElementById('oledDisplayContainer'),
  oledDateDisplay: document.getElementById('oledDateDisplay'),
  oledBleTag: document.getElementById('oledBleTag'),
  oledAlarmIndicator: document.getElementById('oledAlarmIndicator'),
  oledMainTime: document.getElementById('oledMainTime'),
  oledAmPm: document.getElementById('oledAmPm'),
  oledNextAlarmText: document.getElementById('oledNextAlarmText'),
  oledBuzzerStatus: document.getElementById('oledBuzzerStatus'),

  // Display Controls
  btnSyncTime: document.getElementById('btnSyncTime'),
  themeChips: document.getElementById('themeChips'),
  brightnessRange: document.getElementById('brightnessRange'),
  brightnessValText: document.getElementById('brightnessValText'),
  btnFormat12h: document.getElementById('btnFormat12h'),
  btnFormat24h: document.getElementById('btnFormat24h'),
  btnTestBuzzerDirect: document.getElementById('btnTestBuzzerDirect'),

  // Alarms Section
  btnNewAlarm: document.getElementById('btnNewAlarm'),
  alarmForm: document.getElementById('alarmForm'),
  formModeTitle: document.getElementById('formModeTitle'),
  alarmTimeInput: document.getElementById('alarmTimeInput'),
  alarmLabelInput: document.getElementById('alarmLabelInput'),
  daysSelector: document.getElementById('daysSelector'),
  buzzerPatternSelect: document.getElementById('buzzerPatternSelect'),
  snoozeTimeSelect: document.getElementById('snoozeTimeSelect'),
  btnCancelAlarmForm: document.getElementById('btnCancelAlarmForm'),
  alarmsContainer: document.getElementById('alarmsContainer'),
  alarmCount: document.getElementById('alarmCount'),

  // Trigger Modal (Full Screen Jaldi-Jaldi Buzzer)
  alarmActiveOverlay: document.getElementById('alarmActiveOverlay'),
  triggerModalTime: document.getElementById('triggerModalTime'),
  triggerModalLabel: document.getElementById('triggerModalLabel'),
  btnTurnOffAlarm: document.getElementById('btnTurnOffAlarm'),
  btnSnoozeAlarm: document.getElementById('btnSnoozeAlarm'),
  activeSnoozeMinutes: document.getElementById('activeSnoozeMinutes'),

  // Firmware Code Modal
  btnOpenFirmwareCode: document.getElementById('btnOpenFirmwareCode'),
  btnCloseFirmwareModal: document.getElementById('btnCloseFirmwareModal'),
  firmwareModal: document.getElementById('firmwareModal'),
  btnCopyFirmwareCode: document.getElementById('btnCopyFirmwareCode'),
  btnTestAlarmNowModal: document.getElementById('btnTestAlarmNowModal'),
  
  // Toast
  toastContainer: document.getElementById('toastContainer')
};

/* ====================================================================
   INITIALIZATION
   ==================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  initClockTicker();
  initEventListeners();
  initOfflineSupport();
  updateNextAlarmOledDisplay();
  logToConsole('ChronoSync Smart Alarm Ready. Select Connect or Simulator.', 'sys');
});

/* ====================================================================
   LOGGING & TOAST UTILITIES
   ==================================================================== */
function logToConsole(message, type = 'sys') {
  if (!elements.bleLogConsole) return;
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  elements.bleLogConsole.appendChild(entry);
  elements.bleLogConsole.scrollTop = elements.bleLogConsole.scrollHeight;
}

function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconSvg = '';
  if (type === 'success') iconSvg = '✓ ';
  else if (type === 'error') iconSvg = '✕ ';
  else if (type === 'warning') iconSvg = '⚠ ';
  else iconSvg = 'ℹ ';

  toast.innerHTML = `<span>${iconSvg}</span> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ====================================================================
   OFFLINE & SERVICE WORKER
   ==================================================================== */
function initOfflineSupport() {
  function updateNetworkStatus() {
    if (navigator.onLine) {
      elements.offlineBadge.className = 'status-pill status-online';
      elements.offlineStatusText.textContent = 'ONLINE / CACHED';
    } else {
      elements.offlineBadge.className = 'status-pill status-simulating';
      elements.offlineStatusText.textContent = 'OFFLINE (STANDALONE)';
    }
  }

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  // Register Service Worker for true offline caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        logToConsole(`Service Worker active with scope: ${reg.scope}`, 'sys');
      })
      .catch(err => {
        console.warn('Service Worker registration note:', err);
      });
  }
}

/* ====================================================================
   CLOCK & DISPLAY MODE ENGINE
   ==================================================================== */
function initClockTicker() {
  function updateTime() {
    const now = new Date();
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // OLED Date
    elements.oledDateDisplay.textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;

    // OLED Time
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    if (!state.timeFormat24h) {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 hour should be 12
      elements.oledMainTime.innerHTML = `${String(hours).padStart(2, '0')}:${minutes}<span class="oled-seconds">:${seconds}</span>`;
      elements.oledAmPm.textContent = ampm;
      elements.oledAmPm.style.display = 'inline';
    } else {
      elements.oledMainTime.innerHTML = `${String(hours).padStart(2, '0')}:${minutes}<span class="oled-seconds">:${seconds}</span>`;
      elements.oledAmPm.style.display = 'none';
    }

    // Check Alarms every second
    checkAlarmTrigger(now);
  }

  updateTime();
  setInterval(updateTime, 1000);
}

function checkAlarmTrigger(now) {
  // Format current time HH:MM (24-hour internal check)
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTimeString = `${currentHour}:${currentMinute}`;
  const currentDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];

  // Only trigger once per minute
  if (state.lastTriggeredMinute === currentTimeString && now.getSeconds() !== 0) {
    return;
  }

  // Find enabled alarm that matches
  const matchedAlarm = state.alarms.find(alm => {
    if (!alm.enabled) return false;
    if (alm.time !== currentTimeString) return false;
    // Check day match (if days array empty, assume daily)
    if (alm.days && alm.days.length > 0 && !alm.days.includes(currentDayName)) {
      return false;
    }
    return true;
  });

  if (matchedAlarm && !state.activeAlarmTriggered) {
    state.lastTriggeredMinute = currentTimeString;
    triggerAlarm(matchedAlarm);
  }
}

/* ====================================================================
   RAPID BUZZER SYNTHESIZER & ALARM TRIGGER (JLDI JLDI ON-OFF)
   ==================================================================== */
function getAudioContext() {
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextClass();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
  return state.audioCtx;
}

/**
 * Triggers Rapid On-Off Buzzer Synthesizer + Full Screen Urgency Modal + BLE Command
 */
function triggerAlarm(alarm) {
  state.activeAlarmTriggered = alarm;
  const pattern = alarm.pattern || 'rapid';

  logToConsole(`[ALARM EVENT] Alarm Fired: "${alarm.label}" at ${alarm.time}. Pattern: ${pattern.toUpperCase()}`, 'warn');
  sendBleCommand(`BUZZER:ON:${pattern.toUpperCase()}`);

  // Update modal text
  elements.triggerModalTime.textContent = formatDisplayTime(alarm.time);
  elements.triggerModalLabel.textContent = alarm.label || 'Smart Alarm';
  elements.activeSnoozeMinutes.textContent = alarm.snooze || 5;

  // Show full-screen flashing overlay
  elements.alarmActiveOverlay.style.display = 'flex';
  elements.alarmActiveOverlay.classList.add('active');
  elements.alarmActiveOverlay.hidden = false;

  // Start Physical + Emulated Jaldi-Jaldi Buzzer
  startBuzzerPattern(pattern);
}

function startBuzzerPattern(pattern) {
  stopBuzzerAudio(); // Clean previous if any
  const ctx = getAudioContext();

  if (pattern === 'rapid') {
    // Ultra-Rapid Jaldi-Jaldi On/Off Buzzer:
    // 90ms ON (Beep), 80ms OFF, repeating fast!
    let isOn = false;
    state.buzzerIntervalId = setInterval(() => {
      isOn = !isOn;
      if (isOn) {
        playBeepTone(ctx, 2800, 0.08, 'square');
      }
    }, 120);

    // Vibration pattern if supported
    if ('vibrate' in navigator) {
      navigator.vibrate([100, 80, 100, 80, 100, 80]);
      state.vibrationIntervalId = setInterval(() => {
        navigator.vibrate([100, 80, 100, 80]);
      }, 700);
    }

  } else if (pattern === 'double') {
    // Tu-Tu ... Tu-Tu
    let step = 0;
    state.buzzerIntervalId = setInterval(() => {
      if (step === 0 || step === 1) {
        playBeepTone(ctx, 2400, 0.1, 'sine');
      }
      step = (step + 1) % 4; // 2 beeps then pause
    }, 200);

    if ('vibrate' in navigator) {
      state.vibrationIntervalId = setInterval(() => {
        navigator.vibrate([120, 100, 120, 400]);
      }, 800);
    }

  } else if (pattern === 'siren') {
    // Siren Frequency Ramp
    let freq = 800;
    let up = true;
    state.buzzerIntervalId = setInterval(() => {
      freq = up ? freq + 200 : freq - 200;
      if (freq >= 2600) up = false;
      if (freq <= 800) up = true;
      playBeepTone(ctx, freq, 0.07, 'sawtooth');
    }, 80);

    if ('vibrate' in navigator) {
      state.vibrationIntervalId = setInterval(() => {
        navigator.vibrate([200, 100]);
      }, 300);
    }

  } else {
    // Continuous Beep
    state.buzzerIntervalId = setInterval(() => {
      playBeepTone(ctx, 2600, 0.25, 'square');
    }, 300);

    if ('vibrate' in navigator) {
      state.vibrationIntervalId = setInterval(() => {
        navigator.vibrate([250, 50]);
      }, 300);
    }
  }
}

/**
 * Pure Web Audio Tone Generator for authentic piezo buzzer sound
 */
function playBeepTone(ctx, freq, duration, waveType = 'square') {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // Smooth envelope to avoid sharp DC pops
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.error('Audio playback error:', e);
  }
}

function stopBuzzerAudio() {
  if (state.buzzerIntervalId) {
    clearInterval(state.buzzerIntervalId);
    state.buzzerIntervalId = null;
  }
  if (state.vibrationIntervalId) {
    clearInterval(state.vibrationIntervalId);
    state.vibrationIntervalId = null;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
}

/**
 * DISMISS / TURN OFF ALARM (VHA SE OFF KRNA KA OPTION)
 */
function turnOffAlarm() {
  stopBuzzerAudio();
  sendBleCommand('BUZZER:OFF');
  elements.alarmActiveOverlay.style.display = 'none';
  elements.alarmActiveOverlay.classList.remove('active');
  elements.alarmActiveOverlay.hidden = true;

  logToConsole('[ALARM ACTION] Alarm Dismissed & Buzzer Turned OFF by User.', 'sys');
  showToast('Alarm Stopped. Buzzer Turned OFF.', 'success');
  state.activeAlarmTriggered = null;
}

/**
 * SNOOZE ALARM
 */
function snoozeAlarm() {
  if (!state.activeAlarmTriggered) return;
  const snoozeMins = parseInt(state.activeAlarmTriggered.snooze || 5, 10);
  stopBuzzerAudio();
  sendBleCommand(`ALARM:SNOOZE:${snoozeMins}`);
  elements.alarmActiveOverlay.style.display = 'none';
  elements.alarmActiveOverlay.classList.remove('active');
  elements.alarmActiveOverlay.hidden = true;

  // Calculate new time
  const now = new Date();
  now.setMinutes(now.getMinutes() + snoozeMins);
  const snoozedHour = String(now.getHours()).padStart(2, '0');
  const snoozedMin = String(now.getMinutes()).padStart(2, '0');
  const snoozedTimeStr = `${snoozedHour}:${snoozedMin}`;

  logToConsole(`[ALARM ACTION] Alarm snoozed for ${snoozeMins} min (Next alert at ${snoozedTimeStr}).`, 'warn');
  showToast(`Alarm Snoozed for ${snoozeMins} minutes (${formatDisplayTime(snoozedTimeStr)})`, 'info');
  state.activeAlarmTriggered = null;
}

/* ====================================================================
   WEB BLUETOOTH API (BLE ENGINE)
   ==================================================================== */
async function connectBluetoothDevice() {
  // Check Web Bluetooth support
  if (!navigator.bluetooth) {
    showToast('Web Bluetooth API is not supported in this browser. Try Chrome / Edge or use Virtual Simulator!', 'warning', 5000);
    logToConsole('Web Bluetooth not supported by browser. Falling back to simulator availability.', 'warn');
    return;
  }

  try {
    logToConsole('Requesting Bluetooth Device with BLE UART service...', 'sys');

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'ChronoSync' },
        { namePrefix: 'SmartAlarm' },
        { namePrefix: 'ESP32' },
        { services: [BLE_CONFIG.serviceUuid] }
      ],
      optionalServices: [BLE_CONFIG.serviceUuid, 'battery_service', 'device_information']
    });

    logToConsole(`Device selected: ${device.name || 'Unnamed BLE Device'}. Connecting to GATT...`, 'ble-rx');

    device.addEventListener('gattserverdisconnected', onDeviceDisconnected);

    const server = await device.gatt.connect();
    state.bleDevice = device;

    // Discover Service & Characteristics
    const service = await server.getPrimaryService(BLE_CONFIG.serviceUuid);
    state.rxCharacteristic = await service.getCharacteristic(BLE_CONFIG.rxCharUuid);

    // TX Characteristic for incoming notifications
    try {
      state.txCharacteristic = await service.getCharacteristic(BLE_CONFIG.txCharUuid);
      await state.txCharacteristic.startNotifications();
      state.txCharacteristic.addEventListener('characteristicvaluechanged', handleHardwareNotification);
    } catch (e) {
      logToConsole('Optional TX notification characteristic not bound.', 'sys');
    }

    setConnectionState(true, device.name || 'ESP32 Smart Alarm', false);
    showToast(`Connected to ${device.name || 'Smart Alarm'}!`, 'success');
    logToConsole('GATT Connection established. Hardware sync ready.', 'sys');

    // Automatically sync current time & alarms to device
    syncTimeToDevice();
    syncAllAlarmsToDevice();

  } catch (error) {
    if (error.name === 'NotFoundError') {
      logToConsole('User cancelled Bluetooth pairing selection.', 'sys');
    } else {
      console.error('BLE Connection Failed:', error);
      logToConsole(`BLE Error: ${error.message || error}`, 'warn');
      showToast('Bluetooth Connection Failed: ' + (error.message || error), 'error', 4500);
    }
  }
}

function disconnectBluetoothDevice() {
  if (state.isSimulator) {
    setConnectionState(false, 'No Device Connected', false);
    showToast('Virtual Simulator Disconnected', 'info');
    logToConsole('Virtual Simulator deactivated.', 'sys');
    return;
  }

  if (state.bleDevice && state.bleDevice.gatt.connected) {
    state.bleDevice.gatt.disconnect();
  }
  setConnectionState(false, 'No Device Connected', false);
  showToast('Bluetooth Device Disconnected', 'info');
  logToConsole('Bluetooth device disconnected.', 'sys');
}

function onDeviceDisconnected() {
  setConnectionState(false, 'No Device Connected', false);
  showToast('Device Disconnected unexpectedly', 'warning');
  logToConsole('Device disconnected from GATT server.', 'warn');
}

function toggleSimulatorMode() {
  if (state.isSimulator) {
    disconnectBluetoothDevice();
  } else {
    // Activate Virtual BLE Device
    setConnectionState(true, 'Virtual ESP32 Alarm (Simulator)', true);
    showToast('Virtual BLE Simulator Mode Activated! Ready to test.', 'success');
    logToConsole('[SIMULATOR] Virtual BLE Nordic UART Link established (Emulating ESP32-WROOM-32).', 'sys');
    syncTimeToDevice();
  }
}

function setConnectionState(connected, deviceName, isSim) {
  state.isBleConnected = connected;
  state.isSimulator = isSim;

  if (connected) {
    elements.connectedDeviceName.textContent = deviceName;
    elements.connectedDeviceStatus.textContent = isSim 
      ? 'Virtual BLE link active. Alarms and buzzer tests run fully in-browser.' 
      : 'Hardware connected via Bluetooth Low Energy. Live synced.';
    elements.deviceAvatarIcon.classList.add('connected');
    elements.btnConnectBle.classList.add('hidden');
    elements.btnDisconnectBle.classList.remove('hidden');

    if (isSim) {
      elements.bleStatusPill.className = 'status-pill status-simulating';
      elements.bleStatusText.textContent = 'SIMULATOR ACTIVE';
      elements.oledBleTag.textContent = 'VIRTUAL BLE';
      elements.simulateBtnText.textContent = 'Stop Simulator';
    } else {
      elements.bleStatusPill.className = 'status-pill status-connected';
      elements.bleStatusText.textContent = 'BLE CONNECTED';
      elements.oledBleTag.textContent = 'BLE LINKED';
      elements.simulateBtnText.textContent = 'Virtual Simulator';
    }
  } else {
    elements.connectedDeviceName.textContent = 'No Device Connected';
    elements.connectedDeviceStatus.textContent = 'Connect your ESP32 / Arduino BLE Smart Alarm via Bluetooth Low Energy.';
    elements.deviceAvatarIcon.classList.remove('connected');
    elements.btnConnectBle.classList.remove('hidden');
    elements.btnDisconnectBle.classList.add('hidden');
    elements.bleStatusPill.className = 'status-pill status-disconnected';
    elements.bleStatusText.textContent = 'DISCONNECTED';
    elements.oledBleTag.textContent = 'STANDALONE';
    elements.simulateBtnText.textContent = 'Virtual Simulator';
  }
}

/**
 * Transmits packet string over BLE UART characteristic or logs in simulator
 */
async function sendBleCommand(command) {
  const payload = command.endsWith('\n') ? command : command + '\n';

  if (state.isSimulator) {
    logToConsole(`[BLE TX (SIMULATOR)] > ${payload.trim()}`, 'ble-tx');
    // Emulate occasional simulated telemetry
    if (command.startsWith('BUZZER:ON')) {
      elements.oledBuzzerStatus.textContent = 'BUZZER: STROBE ACTIVE';
      elements.oledBuzzerStatus.style.color = '#ef4444';
    } else if (command.startsWith('BUZZER:OFF')) {
      elements.oledBuzzerStatus.textContent = 'BUZZER: READY';
      elements.oledBuzzerStatus.style.color = 'inherit';
    }
    return;
  }

  if (state.isBleConnected && state.rxCharacteristic) {
    try {
      const encoder = new TextEncoder();
      await state.rxCharacteristic.writeValue(encoder.encode(payload));
      logToConsole(`[BLE TX] > ${payload.trim()}`, 'ble-tx');
    } catch (err) {
      console.error('BLE write failed:', err);
      logToConsole(`[BLE TX ERROR] Failed to send: ${err.message}`, 'warn');
    }
  } else {
    logToConsole(`[BLE OFFLINE] Command queued locally: ${payload.trim()}`, 'sys');
  }
}

function handleHardwareNotification(event) {
  const decoder = new TextDecoder();
  const value = decoder.decode(event.target.value);
  logToConsole(`[BLE RX (FROM ESP32)] < ${value.trim()}`, 'ble-rx');

  // Handle hardware incoming strings like "BATTERY:92" or "ALARM_STOPPED"
  if (value.includes('BATTERY:')) {
    const bat = value.split('BATTERY:')[1].trim();
    elements.telBattery.textContent = `${bat}%`;
    elements.telBatteryBar.style.width = `${bat}%`;
  }
}

function syncTimeToDevice() {
  const now = new Date();

  // Send local date + time explicitly. RTClib does not apply time zones to Unix epochs.
  // Format expected by firmware: SYNC_TIME:YYYY-MM-DDTHH:MM:SS
  const localDateTime =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  sendBleCommand(`SYNC_TIME:${localDateTime}`);
  logToConsole(`Requested hardware RTC sync over BLE: ${localDateTime.replace('T', ' ')}`, 'ble-tx');
}

function syncAllAlarmsToDevice() {
  state.alarms.forEach(alm => {
    if (alm.enabled) {
      sendBleCommand(`SET_ALM:${alm.id}:${alm.time}:${alm.days.join(',')}:${alm.pattern}`);
    }
  });
}

/* ====================================================================
   ALARM MANAGER (ADD / TOGGLE / DELETE)
   ==================================================================== */
function renderAlarms() {
  elements.alarmsContainer.innerHTML = '';
  elements.alarmCount.textContent = state.alarms.length;

  if (state.alarms.length === 0) {
    elements.alarmsContainer.innerHTML = `
      <div class="empty-alarms">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.5;">
          <circle cx="12" cy="13" r="8"></circle>
          <path d="M12 9v4l2 2"></path>
          <path d="M5 3L2 6"></path>
          <path d="M22 6L19 3"></path>
        </svg>
        <p>No alarms configured yet.<br>Click <strong>+ New Alarm</strong> to set an alarm with rapid buzzer!</p>
      </div>
    `;
    elements.oledAlarmIndicator.textContent = '⏰ NO ACTIVE ALARMS';
    elements.oledAlarmIndicator.style.color = 'var(--text-dim)';
    elements.oledNextAlarmText.textContent = 'Next: None configured';
    return;
  }

  // Active alarms exist
  elements.oledAlarmIndicator.textContent = '⏰ ALARMS ACTIVE';
  elements.oledAlarmIndicator.style.color = 'var(--accent-emerald)';

  state.alarms.forEach(alm => {
    const card = document.createElement('div');
    card.className = `alarm-card-item ${alm.enabled ? '' : 'disabled'}`;
    card.dataset.id = alm.id;

    // Pattern label formatting
    let patternLabel = '⚡ Jaldi-Jaldi (Rapid)';
    if (alm.pattern === 'double') patternLabel = '🔔 Double Beep';
    else if (alm.pattern === 'continuous') patternLabel = '📢 Continuous Beep';
    else if (alm.pattern === 'siren') patternLabel = '🚨 Ramp Siren';

    // Days label
    const daysLabel = (!alm.days || alm.days.length === 7 || alm.days.length === 0) 
      ? 'Daily' 
      : (alm.days.length === 5 && !alm.days.includes('Sat') && !alm.days.includes('Sun'))
        ? 'Weekdays'
        : alm.days.join(', ');

    const displayTime = formatDisplayTime(alm.time);

    card.innerHTML = `
      <div class="alarm-card-left">
        <div class="alarm-time-num">
          ${displayTime.split(' ')[0]}
          <span class="alarm-time-period">${displayTime.split(' ')[1] || ''}</span>
        </div>
        <div class="alarm-meta">
          <span class="alarm-item-label">${escapeHtml(alm.label || 'Alarm')}</span>
          <span class="alarm-item-pattern-tag">${patternLabel}</span>
          <span class="alarm-item-days">${daysLabel} • Snooze ${alm.snooze}m</span>
        </div>
      </div>
      <div class="alarm-card-right">
        <!-- Enable / Disable Switch -->
        <label class="switch" title="Toggle Alarm">
          <input type="checkbox" class="toggle-alarm-input" ${alm.enabled ? 'checked' : ''}>
          <span class="slider-switch"></span>
        </label>
        
        <!-- Delete Button -->
        <button class="btn-icon-del" title="Delete Alarm">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    // Toggle switch handler
    const toggleInput = card.querySelector('.toggle-alarm-input');
    toggleInput.addEventListener('change', (e) => {
      alm.enabled = e.target.checked;
      card.classList.toggle('disabled', !alm.enabled);
      saveAlarmsToStorage();
      updateNextAlarmOledDisplay();
      sendBleCommand(`TOGGLE_ALM:${alm.id}:${alm.enabled ? 1 : 0}`);
      showToast(`Alarm ${displayTime} ${alm.enabled ? 'Enabled' : 'Disabled'}`, 'info');
    });

    // Delete handler
    const delBtn = card.querySelector('.btn-icon-del');
    delBtn.addEventListener('click', () => {
      deleteAlarm(alm.id);
    });

    elements.alarmsContainer.appendChild(card);
  });

  updateNextAlarmOledDisplay();
}

function handleSaveAlarmForm(e) {
  e.preventDefault();

  const timeVal = elements.alarmTimeInput.value;
  if (!timeVal) {
    showToast('Please select a valid alarm time.', 'warning');
    return;
  }

  // Selected Days
  const activeDayChips = elements.daysSelector.querySelectorAll('.day-chip.active');
  const selectedDays = Array.from(activeDayChips).map(c => c.dataset.day);

  const newAlarm = {
    id: 'alm_' + Date.now(),
    time: timeVal,
    label: elements.alarmLabelInput.value.trim() || 'Alarm',
    days: selectedDays.length > 0 ? selectedDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    pattern: elements.buzzerPatternSelect.value,
    snooze: elements.snoozeTimeSelect.value,
    enabled: true
  };

  state.alarms.push(newAlarm);
  saveAlarmsToStorage();
  renderAlarms();

  // Send BLE command to hardware
  sendBleCommand(`SET_ALM:${newAlarm.id}:${newAlarm.time}:${newAlarm.days.join(',')}:${newAlarm.pattern}`);

  showToast(`Alarm added for ${formatDisplayTime(newAlarm.time)}!`, 'success');
  logToConsole(`New Alarm saved: ${newAlarm.time} (${newAlarm.pattern})`, 'sys');

  // Reset Form
  elements.alarmLabelInput.value = 'Morning Alarm';
}

function deleteAlarm(id) {
  state.alarms = state.alarms.filter(a => a.id !== id);
  saveAlarmsToStorage();
  renderAlarms();
  sendBleCommand(`DEL_ALM:${id}`);
  showToast('Alarm deleted', 'info');
}

function updateNextAlarmOledDisplay() {
  const enabledAlarms = state.alarms.filter(a => a.enabled);
  if (enabledAlarms.length === 0) {
    elements.oledNextAlarmText.textContent = 'Next: None set';
    return;
  }
  // Show first enabled
  const next = enabledAlarms[0];
  elements.oledNextAlarmText.textContent = `Next: ${formatDisplayTime(next.time)} (${next.label})`;
}

function formatDisplayTime(hhmm) {
  if (!hhmm) return '--:--';
  const parts = hhmm.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1];

  if (!state.timeFormat24h) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }
  return `${String(h).padStart(2, '0')}:${m}`;
}

/* ====================================================================
   PERSISTENCE (LOCAL STORAGE)
   ==================================================================== */
function saveAlarmsToStorage() {
  try {
    localStorage.setItem('chronosync_alarms', JSON.stringify(state.alarms));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }
}

function loadSavedState() {
  try {
    const savedAlarms = localStorage.getItem('chronosync_alarms');
    if (savedAlarms) {
      state.alarms = JSON.parse(savedAlarms);
    } else {
      // Default sample alarm
      state.alarms = [
        {
          id: 'alm_default_1',
          time: '07:00',
          label: 'Morning Wakeup',
          days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          pattern: 'rapid', // Jaldi Jaldi on-off!
          snooze: '10',
          enabled: true
        }
      ];
      saveAlarmsToStorage();
    }

    const savedTheme = localStorage.getItem('chronosync_theme');
    if (savedTheme) applyTheme(savedTheme);

    const saved24h = localStorage.getItem('chronosync_24h');
    if (saved24h !== null) {
      state.timeFormat24h = saved24h === 'true';
      updateTimeFormatButtons();
    }

    renderAlarms();
  } catch (e) {
    console.error('Failed to load saved alarms:', e);
  }
}

function applyTheme(themeName) {
  document.body.className = `theme-${themeName}`;
  state.currentTheme = themeName;
  localStorage.setItem('chronosync_theme', themeName);

  elements.themeChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === themeName);
  });

  sendBleCommand(`SET_THEME:${themeName}`);
}

function updateTimeFormatButtons() {
  elements.btnFormat12h.classList.toggle('active', !state.timeFormat24h);
  elements.btnFormat24h.classList.toggle('active', state.timeFormat24h);
  renderAlarms();
}

/* ====================================================================
   EVENT LISTENERS
   ==================================================================== */
function initEventListeners() {
  // BLE Connect / Disconnect / Simulator
  elements.btnConnectBle.addEventListener('click', connectBluetoothDevice);
  elements.btnDisconnectBle.addEventListener('click', disconnectBluetoothDevice);
  elements.btnSimulateBle.addEventListener('click', toggleSimulatorMode);

  // Toggle Hidden Device Details (Clean minimal view as requested!)
  elements.btnToggleDetails.addEventListener('click', () => {
    state.isDetailsVisible = !state.isDetailsVisible;
    elements.hiddenDeviceDetails.hidden = !state.isDetailsVisible;
    elements.btnToggleDetails.setAttribute('aria-expanded', state.isDetailsVisible);
    const chevron = elements.btnToggleDetails.querySelector('.chevron-indicator');
    chevron.classList.toggle('chevron-rotate', state.isDetailsVisible);
  });

  elements.btnClearLogs.addEventListener('click', () => {
    elements.bleLogConsole.innerHTML = '';
  });

  // Display Controls
  elements.btnSyncTime.addEventListener('click', syncTimeToDevice);

  elements.themeChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) applyTheme(chip.dataset.theme);
  });

  elements.brightnessRange.addEventListener('input', (e) => {
    const val = e.target.value;
    elements.brightnessValText.textContent = `${val}%`;
    elements.oledDisplayContainer.style.opacity = Math.max(0.35, val / 100);
  });

  elements.brightnessRange.addEventListener('change', (e) => {
    sendBleCommand(`SET_BRIGHT:${e.target.value}`);
  });

  elements.btnFormat12h.addEventListener('click', () => {
    state.timeFormat24h = false;
    localStorage.setItem('chronosync_24h', 'false');
    updateTimeFormatButtons();
  });

  elements.btnFormat24h.addEventListener('click', () => {
    state.timeFormat24h = true;
    localStorage.setItem('chronosync_24h', 'true');
    updateTimeFormatButtons();
  });

  // Direct 3s Buzzer Test Check
  elements.btnTestBuzzerDirect.addEventListener('click', () => {
    showToast('Testing Rapid Buzzer (Jaldi-Jaldi 3s Check)...', 'warning');
    sendBleCommand('BUZZER:ON:RAPID');
    startBuzzerPattern('rapid');
    setTimeout(() => {
      stopBuzzerAudio();
      sendBleCommand('BUZZER:OFF');
      showToast('Buzzer test finished.', 'info');
    }, 3000);
  });

  // Days selector clicks
  elements.daysSelector.addEventListener('click', (e) => {
    const dayBtn = e.target.closest('.day-chip');
    if (dayBtn) {
      dayBtn.classList.toggle('active');
    }
  });

  // Alarm Form Submit
  elements.alarmForm.addEventListener('submit', handleSaveAlarmForm);
  elements.btnCancelAlarmForm.addEventListener('click', () => {
    elements.alarmLabelInput.value = 'Morning Alarm';
  });

  // FULL SCREEN ALARM MODAL ACTIONS (OFF & SNOOZE)
  elements.btnTurnOffAlarm.addEventListener('click', turnOffAlarm);
  elements.btnSnoozeAlarm.addEventListener('click', snoozeAlarm);

  // Trigger Immediate Alarm Modal Simulation
  elements.btnTestAlarmNowModal.addEventListener('click', () => {
    const testAlm = state.alarms[0] || {
      id: 'test_now',
      time: '12:00',
      label: 'Emergency Test Alarm',
      pattern: 'rapid',
      snooze: '5'
    };
    triggerAlarm(testAlm);
  });

  // ESP32 Arduino Firmware Modal
  elements.btnOpenFirmwareCode.addEventListener('click', () => {
    elements.firmwareModal.style.display = 'flex';
    elements.firmwareModal.classList.add('active');
    elements.firmwareModal.hidden = false;
  });

  elements.btnCloseFirmwareModal.addEventListener('click', () => {
    elements.firmwareModal.style.display = 'none';
    elements.firmwareModal.classList.remove('active');
    elements.firmwareModal.hidden = true;
  });

  elements.btnCopyFirmwareCode.addEventListener('click', () => {
    const code = document.getElementById('firmwareCodeBlock').innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast('ESP32 Arduino Firmware copied to clipboard!', 'success');
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
