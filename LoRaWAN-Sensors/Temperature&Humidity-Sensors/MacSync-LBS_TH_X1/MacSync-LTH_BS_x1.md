# 📡 MacSync-LTH_BS_x1 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync-LTH_BS_x1** is a LoRaWAN-enabled **Temeperature & Humidity sensor** ( [SHT40](https://sensirion.com/products/catalog/SHT40) ) device. This repository provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

---

## 📂 Repository Structure

MacSync-LTH_BS_x1/
│
├── Decoder/
│   ├── MacSync-LTH_BS_x1_TTN.js
│   ├── MacSync-LTH_BS_x1_Chirpstack.js
│   ├── MacSync-LTH_BS_x1_Milesight.js
│
├── Encoder/
│   ├── MacSync-LTH_BS_x1_TTN.js
│   ├── MacSync-LTH_BS_x1_Milesight.js
│
└── MacSync-LTH_BS_x1.md

---

## 🔄 Codec Overview

| Type     | Direction | Purpose                          |
|----------|----------|----------------------------------|
| Decoder  | Uplink   | Bytes → JSON (sensor data)       |
| Encoder  | Downlink | JSON → Bytes (device commands)   |

---

## 🔓 Decoder (Uplink)

Converts raw LoRaWAN payload into readable JSON.

### ✅ Supported Platforms
- TTN (The Things Network)
- ChirpStack
- Milesight Gateway

### 📥 Input
- Raw payload (HEX/Base64 / bytes)

### 📤 Output (Example)
```json
{
  "temperature": 25.6,
  "humidity": 60.2,
  "battery": 100
}
```

## 🔓 Encoder (Downlink)

Converts JSON commands into encoded payload for device configuration.


## 📌 MQTT Downlink Basics (ChirpStack v4)

### Topic Format
```
application/{applicationId}/device/{devEui}/command/down
```

### Generic MQTT Payload Structure
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "...": "payload fields",
    "fPort": X
  }
}
```

---

## 1. Change Transmission Interval  
**FPort:** `06`

### Description
- Sets uplink transmission interval in **seconds**
- Device applies new interval immediately

### ChirpStack Object JSON
```json
{
  "txTime": 600,
  "fPort": 6
}
```

### MQTT JSON Example
```json
{
  "devEui": "0080e11505ca2663",
  "confirmed": true,
  "object": {
    "txTime": 600,
    "fPort": 6
  }
}
```