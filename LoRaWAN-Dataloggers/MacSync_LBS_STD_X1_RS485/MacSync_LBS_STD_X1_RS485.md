# 📡 MacSync_LBS_STD_X1_RS485 LoRaWAN Codec Documentation

## 📘 Overview
**MacSync_LBS_STD_X1_RS485** is an **RS485 (Modbus RTU) & Analog to LoRaWAN® Datalogger** from the MacSync LX1 family. It wirelessly connects Modbus RTU devices (energy meters, PLCs, flow meters, transmitters) and analog instruments (4–20 mA / 0–10 V / digital inputs) to LoRaWAN® networks. See the [product page](https://macnman.com/docs/product/lorawan/dataloggers/rs485-analog-to-lorawan-converter-macsync-lx1) for hardware details.

This folder provides JavaScript-based **decoder** (uplink) and **encoder** (downlink) scripts compatible with TTN, ChirpStack, and Milesight LNS.

> ℹ️ All MacSync LX1 datalogger power variants run the same firmware payload format — this codec applies to every variant.

---

## 📂 Repository Structure

```
MacSync_LBS_STD_X1_RS485/
│
├── Decoder/
│   ├── MacSync_LBS_STD_X1_RS485_TTN.js         (decodeUplink / encodeDownlink)
│   ├── MacSync_LBS_STD_X1_RS485_Chirpstack.js  (ChirpStack v4 + v3-compat Decode)
│   ├── MacSync_LBS_STD_X1_RS485_Milesight.js   (v3 style: Decode / Encode)
│
├── Encoder/
│   ├── MacSync_LBS_STD_X1_RS485_Encoder.js     (standalone encodeDownlink)
│
└── MacSync_LBS_STD_X1_RS485.md
```

---

## 🔓 Decoder (Uplink)

### ✅ Supported Platforms
- TTN (The Things Network) — `decodeUplink(input)`
- ChirpStack v4 — `decodeUplink(input)` (v3 `Decode` wrapper included)
- Milesight Gateway (built-in NS) — `Decode(fPort, bytes)` / `Encode(fPort, obj)` — paste the whole file into both codec boxes

### 📦 Uplink Frame Types (by FPort)

| FPort | `type` | Content |
|-------|--------|---------|
| `2`   | `heartbeat` | RS485 field sweep **or** analog channels + battery + UTC |
| `3`   | `sampling` | 2–12 buffered float32 samples + battery + UTC |
| `4`   | `trigger` | ALARM / CLEAR event with value + min/max + battery + UTC |
| `5`   | `boot` | FW version (3B) + HW version (3B) + UTC (4B) |
| `16–21` | `config_ack` | Echo of the applied config downlink + battery |
| `8/9/10/12/13/15` | `modbus_ack` | Reply to a Modbus command downlink + UTC |

Every decoded uplink has the shape:
```
type        heartbeat | sampling | trigger | boot | config_ack | modbus_ack
deviceInfo  { fPort, source, battery, unixUTC, timeUTC, timeIST, ... }
sensorInfo  readings          (heartbeat / sampling / trigger)
configAck   applied config    (ports 16-21)
modbusAck   downlink reply    (ports 8/9/10/12/13/15)
```

#### FPort 2 — RS485 heartbeat
`[0]=1`, `[1]=0` (source RS485), then **one tag byte per configured field (1–20)**:
- Tag byte = `(dataType << 5) | count`; `count = 0` → marker: dataType `6` = disabled, `7` = read error
- Data types: `0` int16 · `1` uint16 · `2` int32 · `3` int32 swapped · `4` float32 · `5` float32 swapped · `6` uint32 swapped · `7` uint32 (16-bit types = 2 bytes/value, 32-bit = 4 bytes/value)
- Trailer: battery % (1B) + UTC seconds (4B, big-endian)

```json
{
  "type": "heartbeat",
  "deviceInfo": { "fPort": 2, "source": "rs485", "battery": 97,
                  "unixUTC": 1757923200, "timeUTC": "2025-09-15T08:00:00Z",
                  "timeIST": "2025-09-15T13:30:00+05:30" },
  "sensorInfo": {
    "fields": [
      { "field": 1, "status": "ok", "data_type": "float32", "values": [230.4] },
      { "field": 2, "status": "disabled" }
    ],
    "fields_ok": 1, "fields_off": 1, "fields_failed": 0
  }
}
```

#### FPort 2 — Analog heartbeat
`[0]=1`, `[1]=1` (source analog), then per channel (A/B): mode byte (`1` = 4-20 mA, `2` = 0-10 V, `3` = digital) + 16-bit value ×1000, or a single `0x00` when off. Trailer: battery + UTC.

```json
{
  "type": "heartbeat",
  "deviceInfo": { "fPort": 2, "source": "analog", "battery": 98, "unixUTC": 1757923200 },
  "sensorInfo": {
    "channels": [
      { "channel": "A", "sensor_type": "4-20mA", "status": "ok", "current_mA": "12.35" },
      { "channel": "B", "sensor_type": "off", "status": "not_configured" }
    ]
  }
}
```
4–20 mA readings also carry `fault: "under_range"` (< 3.5 mA) or `"over_range"` (> 20.5 mA).

#### FPort 3 — Sampling batch
`[0]` count (2–12) · `[1]` source (0 = RS485, 1 = analog) · `[2]` marker (0 = both streams, 1/2 = single field/channel) · type byte(s) · float32 samples (big-endian) · battery · UTC.

#### FPort 4 — Trigger
15 bytes: trig, param, event (1 = ALARM, 0 = CLEAR), value ×100, min ×100, max ×100, battery, UTC, source. (14-byte frames from older firmware are also decoded.)

---

## 🔒 Encoder (Downlink)

JSON → bytes. **Put the port number in the JSON as `"port"` and set the same value as the downlink FPort.** Every applied command is echoed back by the device on the same port (`config_ack` / `modbus_ack`).

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
    "port": X
  }
}
```

---

## ⚙️ Config Commands

### 1. Transmission Interval — **FPort 16**
Heartbeat interval in seconds (60–86400).
```json
{ "port": 16, "interval": 300 }
```

### 2. ADR On/Off — **FPort 17** (device reboots)
```json
{ "port": 17, "adr": 1 }
```

### 3. Message Type — **FPort 18** (`0` unconfirmed, `1` confirmed)
```json
{ "port": 18, "msgtype": 1 }
```

### 4. Message Info — **FPort 19** (ADR + SF 7–12 + msgtype; device reboots)
```json
{ "port": 19, "adr": 1, "sf": 7, "msgtype": 1 }
```

### 5. Trigger Configuration — **FPort 20**
`trig` 1/2 · `param` 0 = Field 1/Channel A, 1 = Field 2/Channel B · `min`/`max` threshold window · `checktime` seconds · `enable` 0/1
```json
{ "port": 20, "trig": 1, "param": 0, "min": 2.2, "max": 6.6, "checktime": 30, "enable": 1 }
```

### 6. Sampling Configuration — **FPort 21**
`param` 0/1 = single field/channel, 2 = both · `count` 2–12 · `enable` 0/1 · optional `interval` per-sample seconds (30–3600)
```json
{ "port": 21, "param": 0, "count": 2, "enable": 1, "interval": 60 }
```

---

## 🔧 Modbus / RS485 Commands

**Data Type Mapping:** `0` INT16 · `1` UINT16 · `2` INT32 · `3` INT32 swapped · `4` FLOAT32 · `5` FLOAT32 swapped · `6` UINT32 swapped · `7` UINT32

### 7. Field Configuration — **FPort 10** (field 1–20)
```json
{ "port": 10, "index": 1, "slaveId": 1, "fc": 4, "enable": 1, "dataType": 1, "numParams": 2, "address": 1 }
```

### 8. Read Back a Field Configuration — **FPort 15**
```json
{ "port": 15, "index": 1 }
```

### 9. Live Register Read — **FPort 13**
```json
{ "port": 13, "slaveId": 1, "fc": 4, "dataType": 1, "numParams": 2, "address": 1 }
```

### 10. Register Write — **FPort 9** (`numReg: 2` sends a 32-bit value)
```json
{ "port": 9, "slaveId": 1, "numReg": 1, "address": 1, "value": 1234 }
```

### 11. Coil Write — **FPort 8**
```json
{ "port": 8, "slaveId": 1, "numReg": 1, "address": 1, "value": 1 }
```

### 12. RS485 Baud Rate — **FPort 12** (baud 1200–115200; parity `0` none, `1` odd, `2` even)
```json
{ "port": 12, "baud": 9600, "parity": 0 }
```
