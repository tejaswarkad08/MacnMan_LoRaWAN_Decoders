// ===================================================================
// DOWNLINK ENCODER — JSON -> bytes. Enqueue with matching fPort + "port".
//   16 TXinterval, 17 ADR, 18 MsgType, 19 MSGINFO(adr+sf+msgtype),
//   20 TrigCfg(+enable), 21 SampCfg(+enable)
//   MSGINFO takes "sf" 7..12, sent RAW on the wire. The firmware converts
//   SF<->DR (downlink path only); the codec does no rate math.
//   (standalone DR removed; set SF via MSGINFO on port 19)
// ===================================================================
function encodeDownlink(input) {
  var d = input.data;
  // ChirpStack may not pass input.fPort into encodeDownlink reliably,
  // so accept a "port" field in the JSON as the primary source.
  var fport = (d && d.port !== undefined) ? d.port : input.fPort;
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
      return { bytes: [], fPort: fport, errors: ["unknown fPort " + fport] };
  }
  return { bytes: bytes, fPort: fport };
}

// ===================================================================
// DOWNLINK DECODER — lets ChirpStack show queued downlinks back as JSON
// ===================================================================
function decodeDownlink(input) {
  var b = input.bytes, p = input.fPort, o = {};
  switch (p) {
    case 16: o.interval = (b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3]; break;
    case 17: o.adr = b[0]; break;
    case 18: o.msgtype = b[0]; break;
    case 19: o.adr=b[0]; o.sf=b[1]; o.msgtype=b[2]; break;    // wire carries SF
    case 20:
      o.trig=b[0]; o.param=b[1];
      o.min=((b[2]<<8)|b[3])/100; o.max=((b[4]<<8)|b[5])/100;
      o.checktime=(b[6]<<8)|b[7]; o.enable=b[8];
      break;
    case 21: o.param=b[0]; o.count=b[1]; o.enable=b[2]; break;
  }
  return { data: o };
}