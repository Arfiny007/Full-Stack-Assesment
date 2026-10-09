import "dotenv/config";
import mqtt from "mqtt";
import { randomBytes } from "node:crypto";
const candidate = process.env.CANDIDATE_ID;
if (!candidate) throw new Error("CANDIDATE_ID is required");
const client = mqtt.connect(
  process.env.MQTT_URL ?? "mqtt://152.42.238.142:1883",
  {
    clientId: `fse01-${candidate}-${randomBytes(4).toString("hex")}`,
    protocolVersion: 4,
    reconnectPeriod: 0,
    connectTimeout: 10000,
  },
);
const timer = setTimeout(() => {
  console.error("MQTT probe timeout: no CONNACK/SUBACK");
  client.end(true);
  process.exitCode = 1;
}, 15000);
client.on("connect", () => {
  console.log("Live broker CONNACK received");
  client.subscribe(
    [`fse-01/${candidate}/response`, `fse-01/${candidate}/status`],
    { qos: 1 },
    (error, granted) => {
      if (error || granted?.some((g) => g.qos === 128)) {
        console.error(error ?? "Subscription rejected");
        process.exitCode = 1;
      } else
        console.log(
          "Live broker QoS1 SUBACK received for candidate " + candidate,
        );
      clearTimeout(timer);
      client.end();
    },
  );
});
client.on("error", (error) => {
  console.error(error.message);
  clearTimeout(timer);
  client.end(true);
  process.exitCode = 1;
});
