# 📡 MacnMan LoRaWAN Decoders

JavaScript payload **decoders** (uplink: bytes → JSON) and **encoders** (downlink: JSON → bytes) for **Macnman LoRaWAN® devices**, compatible with **TTN (The Things Network)**, **ChirpStack**, and **Milesight gateways** (built-in network server).

📚 Product documentation & datasheets: [macnman.com/docs](https://macnman.com/docs/category/lorawan)

---

## 📂 Device Index

| Device | Description | Codec |
|--------|-------------|-------|
| [MacSync_LBS_STD_X1_RS485](LoRaWAN-Dataloggers/MacSync_LBS_STD_X1_RS485) | RS485 (Modbus RTU) & Analog to LoRaWAN® datalogger (MacSync LX1 family) | Decoder + Encoder |
| [MacSync-LBS-TH-X1](LoRaWAN-Sensors/MacSync-LBS-TH-X1) | Temperature & humidity sensor (SHT40) | Decoder + Encoder |

---

## 🚀 How to Use

Each device folder contains:

```
<Device>/
├── Decoder/          complete codec (uplink decoder + downlink encoder), one file per platform
│   ├── <Device>_TTN.js
│   ├── <Device>_Chirpstack.js
│   └── <Device>_Milesight.js
├── Encoder/          standalone downlink encoder (reference copy)
│   └── <Device>_Encoder.js
└── <Device>.md       payload format + downlink command reference
```

Each file in `Decoder/` is **complete** — it contains both the uplink decoder and the downlink encoder, so one paste per platform is enough.

### TTN (The Things Stack)
1. Console → *Applications → your app → Payload formatters → Uplink*.
2. Select **Custom Javascript formatter** and paste the whole `_TTN.js` file.
3. Paste the same file into the *Downlink* formatter (it contains `encodeDownlink`).

### ChirpStack v4
1. *Device profile → Codec → JavaScript functions*.
2. Paste the whole `_Chirpstack.js` file.
3. Queue downlinks via MQTT on `application/{applicationId}/device/{devEui}/command/down` — see each device's `.md` for the JSON commands.

### Milesight Gateway (UG63 / UG65 / UG67, built-in NS)
1. *Network Server → Profiles → device profile → Payload Codec → Custom*.
2. Paste the whole `_Milesight.js` file into **both** the decoder box and the encoder box.

---

## 🔄 Codec Conventions

- **Uplink JSON** contains `type` (heartbeat / sampling / trigger / boot / config_ack / …), `deviceInfo` (battery, UTC + IST timestamps, fPort) and `sensorInfo` (readings).
- **Downlink JSON** carries the target port as `"port"` (the key `"fPort"` also works) — see each device's `.md` for the full command table. Every applied command is echoed back by the device on the same port.
- Timestamps are Unix UTC seconds, big-endian on the wire.

---

## 🏢 Macnman Technologies Pvt. Ltd.

[macnman.com](https://www.macnman.com) · [Product documentation](https://macnman.com/docs)
