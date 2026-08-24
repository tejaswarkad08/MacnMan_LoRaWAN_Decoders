// ===================================================================
// Milesight gateway built-in NS codec — SHT40 LoRaWAN node (MacSync-L)
//
// Milesight's embedded network server (UG63/UG65/UG67) is ChirpStack
// v3 based, so it uses the v3 codec entry points:
//     function Decode(fPort, bytes)  -> returns the decoded object
//     function Encode(fPort, obj)    -> returns an array of bytes
// There is no { data: ... } wrapper, no warnings channel, and no
// decodeDownlink() hook in this format.
//
// WHERE TO PASTE:  Network Server -> Profiles -> <device profile> ->
// Payload Codec = "Custom". Paste this WHOLE file into BOTH the
// decoder box and the encoder box — each box runs in its own scope,
// and unused functions are ignored, so whole-file paste is safe and
// keeps the helpers available where they are needed.
//
// (If your gateway's codec template shows decodeUplink(input) instead
//  of Decode(fPort, bytes), that firmware is v4-style — use the
//  original ChirpStack v4 codec unchanged.)
//
// Byte layouts and the decoded JSON structure (deviceInfo/sensorInfo,
// UTC + IST timestamps) are identical to the ChirpStack v4 codec.
//
// UPLINK ports:   0x02 heartbeat, 0x03 multi-sample, 0x04 trigger,
//                 0x05 boot, 0x10-0x15 config-ACK (echo of downlink)
// DOWNLINK ports: 16 TXinterval, 17 ADR, 18 MsgType, 19 MSGINFO,
//                 20 TrigCfg(+enable), 21 SampCfg(+enable)
//   NOTE: standalone DR port removed. DR is set only via MSGINFO (19).
//   MSGINFO takes "sf" 7..12 (raw on the wire; firmware converts
//   SF<->DR on the downlink path).
// ===================================================================

var IST_OFFSET = 19800;   // +5:30 in seconds

// ---- helpers (used by Decode) -------------------------------------
function u32(b, i) {                          // big-endian uint32
  return ((b[i] << 24) | (b[i+1] << 16) | (b[i+2] << 8) | b[i+3]) >>> 0;
}
function s16(b, i) {                          // big-endian signed int16
  var v = (b[i] << 8) | b[i+1];
  return (v & 0x8000) ? v - 0x10000 : v;
}
function pad(n) { return ("0" + n).slice(-2); }

// Convert a raw x100 int16 to a 2-decimal value (e.g. 2500 -> 25.00)
function val2(b, i) {
  return s16(b, i) / 100;
}

// Build an ISO-like string with explicit offset suffix.
function isoString(unixSec, offsetSec) {
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

// Build a deviceInfo object with the time fields + battery + fPort.
function buildDeviceInfo(fPort, battery, unixUTC) {
  return {
    fPort:   fPort,
    battery: battery,
    unixUTC: unixUTC,
    timeUTC: isoString(unixUTC, 0),
    timeIST: isoString(unixUTC, IST_OFFSET)
  };
}

// ===================================================================
// UPLINK DECODER  (Milesight / ChirpStack v3 entry point)
// Returns the decoded object directly — no { data: ... } wrapper.
// ===================================================================
function Decode(fPort, bytes) {
  var b = bytes;
  var data = {};

  // ============ PORT 0x05 : BOOT UPLINK #1 (device info) ============
  if (fPort === 0x05) {
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, u32(b, 6));   // UTC at byte 6
    delete data.deviceInfo.battery;                              // boot has no battery reading
    data.deviceInfo["Firmware Version"] = b[0] + "." + b[1] + "." + b[2];   // "1.0.0"
    data.deviceInfo["Hardware Version"] = b[3] + "." + b[4] + "." + b[5];   // "2.0.0"
    return data;
  }

  // ====== PORTS 0x10..0x15 : CONFIG ACK (echo of applied downlink) ======
  // Device re-sends on the SAME port the downlink used, echoing the values
  // now stored in EEPROM, then battery %. Numeric fields are shown as
  // human-readable strings (ON/OFF, CONFIRMED/..., ENABLED/...).
  if (fPort >= 0x10 && fPort <= 0x15) {
    var ack = { appliedPort: fPort };

    if (fPort === 0x10) {                    // interval u32 + batt
      ack.feature  = "tx_interval";
      ack.interval = u32(b, 0);
      ack.battery  = b[4];

    } else if (fPort === 0x11) {             // adr + batt
      ack.feature = "adr";
      ack.adr     = (b[0] === 1) ? "ON" : "OFF";
      ack.battery = b[1];

    } else if (fPort === 0x12) {             // msgtype + batt
      ack.feature = "msg_type";
      ack.msgtype = (b[0] === 1) ? "CONFIRMED" : "UNCONFIRMED";
      ack.battery = b[1];

    } else if (fPort === 0x13) {             // adr, SF, msgtype + batt
      ack.feature = "msg_info";
      ack.adr     = (b[0] === 1) ? "ON" : "OFF";
      ack.sf      = b[1];                    // firmware echoes SF directly (7..12)
      ack.msgtype = (b[2] === 1) ? "CONFIRMED" : "UNCONFIRMED";
      ack.battery = b[3];

    } else if (fPort === 0x14) {             // trig,param,min,max,ct,en + batt
      ack.feature   = "trigger";
      ack.trig      = b[0];
      ack.param     = (b[1] === 1) ? "humidity" : "temperature";
      ack.min       = s16(b, 2) / 100;
      ack.max       = s16(b, 4) / 100;
      ack.checktime = (b[6] << 8) | b[7];
      ack.enable    = (b[8] === 1) ? "ENABLED" : "DISABLED";
      ack.battery   = b[9];

    } else {                                 // 0x15 param,count,en + batt
      ack.feature = "sampling";
      ack.param   = (b[0] === 0) ? "temperature" :
                    (b[0] === 1) ? "humidity" : "both";
      ack.count   = b[1];
      ack.enable  = (b[2] === 1) ? "ENABLED" : "DISABLED";
      ack.battery = b[3];
    }

    data.type = "config_ack";
    data.configAck = ack;
    return data;
  }

  // ============ PORT 0x04 : TRIGGER ALARM / CLEAR (14 bytes, no header) ============
  // [0]trigNum [1]param [2]event
  // [3-4]value [5-6]min [7-8]max [9]battery [10-13]UTC
  if (fPort === 0x04) {
    data.type = "trigger";

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, b[9], u32(b, 10));
    data.deviceInfo.trigNum = b[0];                        // 1 or 2
    data.deviceInfo.event   = (b[2] === 1) ? "ALARM" : "CLEAR";

    // --- sensor info ---
    var param = (b[1] === 0) ? "temperature" : "humidity";
    data.sensorInfo = {
      param: param,
      value: val2(b, 3),
      min:   val2(b, 5),
      max:   val2(b, 7)
    };
    return data;
  }

  // ============ PORT 0x02 : SINGLE READING (heartbeat, 10 bytes) ============
  if (fPort === 0x02) {
    var error = (b[0] === 1);
    data.type = "heartbeat";

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, b[5], u32(b, 6));

    // --- sensor info ---
    data.sensorInfo = {
      temperature: error ? "error" : val2(b, 1),
      humidity:    error ? "error" : val2(b, 3)
    };
    return data;
  }

  // ============ PORT 0x03 : MULTI-SAMPLE BATCH (variable width) ============
  if (fPort === 0x03) {
    data.type = "sampling";

    var count = b[0];
    var param = b[1];                        // 0=temp, 1=hum, 2=both

    // walk the sample block first to locate battery + UTC at the end
    var samples = [];
    var idx = 2;
    for (var n = 0; n < count; n++) {
      var sObj = {};
      if (param === 0) {
        sObj.temperature = val2(b, idx);  idx += 2;
      } else if (param === 1) {
        sObj.humidity    = val2(b, idx);  idx += 2;
      } else {
        sObj.temperature = val2(b, idx);  idx += 2;
        sObj.humidity    = val2(b, idx);  idx += 2;
      }
      samples.push(sObj);
    }
    var battery = b[idx];     idx += 1;      // battery after sample block
    var unixUTC = u32(b, idx);               // one UTC stamp for the batch

    // --- device info ---
    data.deviceInfo = buildDeviceInfo(fPort, battery, unixUTC);

    // --- sensor info ---
    data.sensorInfo = {
      param:   (param === 0) ? "temperature"
             : (param === 1) ? "humidity" : "both",
      count:   count,
      samples: samples
    };
    return data;
  }

  // ============ Unknown port ============
  // v3 format has no separate "warnings" channel — embed it in the object.
  data.fPort = fPort;
  data.warning = "Unknown fPort " + fPort;
  return data;
}

// ===================================================================
// DOWNLINK ENCODER  (Milesight / ChirpStack v3 entry point)
// JSON -> bare byte array (no { bytes, fPort } wrapper).
//   16 TXinterval, 17 ADR, 18 MsgType, 19 MSGINFO(adr+sf+msgtype),
//   20 TrigCfg(+enable), 21 SampCfg(+enable)
//   MSGINFO takes "sf" 7..12, sent RAW on the wire; the firmware
//   converts SF<->DR on the downlink path. The codec does no rate math.
//
//   The frame is transmitted on the fPort you set when queuing the
//   downlink, and Encode() reliably receives that same fPort here (the
//   v4 quirk doesn't exist in v3), so the layout is selected from the
//   fPort argument first. A "port" field inside the JSON is kept only
//   as a fallback for compatibility with the ChirpStack JSON bodies —
//   if both are present they must match.
//
//   NOTE: the gateway UI page "Network Server -> Packets -> Send Data
//   to Device" sends RAW payloads and does NOT run Encode(). Use the
//   hex cheat-sheet at the bottom for manual sends from that page.
// ===================================================================
function Encode(fPort, obj) {
  var d = obj || {};
  var fport = (fPort !== undefined && fPort !== null && fPort !== 0)
              ? fPort
              : d.port;
  var bytes = [];

  switch (fport) {
    case 16: // TX interval (seconds, 60..86400)
      var s = d.interval >>> 0;
      bytes = [(s>>24)&0xFF, (s>>16)&0xFF, (s>>8)&0xFF, s&0xFF];
      break;

    case 17: // ADR (0/1)
      bytes = [d.adr & 0x01];
      break;

    case 18: // Msg type (0=unconf,1=conf)
      bytes = [d.msgtype & 0x01];
      break;

    case 19: // MSGINFO: adr, SF(7..12), msgtype   (SF sent raw; firmware converts to DR)
      var sfv;
      if (d.sf !== undefined) {
        sfv = d.sf & 0xFF;
      } else {
        sfv = 12 - (d.dr & 0xFF);            // fallback if caller still sends dr
      }
      if (sfv < 7)  sfv = 7;
      if (sfv > 12) sfv = 12;                // clamp to valid IN865 SF range
      bytes = [d.adr & 0x01, sfv & 0xFF, d.msgtype & 0x01];
      break;

    case 20: // Trigger config: trig,param,min,max,checktime,enable
      var mn = Math.round(d.min * 100);
      var mx = Math.round(d.max * 100);
      var ct = d.checktime >>> 0;
      bytes = [
        d.trig & 0xFF, d.param & 0xFF,
        (mn>>8)&0xFF, mn&0xFF,
        (mx>>8)&0xFF, mx&0xFF,
        (ct>>8)&0xFF, ct&0xFF,
        d.enable & 0x01
      ];
      break;

    case 21: // Sampling config: param, count, enable
      bytes = [d.param & 0xFF, d.count & 0xFF, d.enable & 0x01];
      break;

    default:
      bytes = [];                            // unknown port -> send nothing
      break;
  }
  return bytes;
}

// -------------------------------------------------------------------
// MANUAL DOWNLINK CHEAT-SHEET (raw HEX for "Send Data to Device"):
//   fPort 16  TX interval 900 s ................... 00000384
//   fPort 17  ADR ON .............................. 01
//   fPort 18  CONFIRMED uplinks ................... 01
//   fPort 19  ADR=OFF, SF9, CONFIRMED ............. 000901
//   fPort 20  T1, temperature, 20.00..30.00 C,
//             checktime 60 s, ENABLED ............. 010007D00BB8003C01
//   fPort 21  both params, 5 samples, ENABLED ..... 020501
// -------------------------------------------------------------------