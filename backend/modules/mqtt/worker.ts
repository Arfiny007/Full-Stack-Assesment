import mqtt, { type MqttClient } from "mqtt";
import { randomBytes } from "node:crypto";
import { handleChallenge, recordChallengeFailure } from "./service.js";
import * as repo from "./repository.js";
let client: MqttClient | undefined;
let connected = false;
let lastError: string | null = null;
const candidate = process.env.CANDIDATE_ID?.trim() || null;
export async function mqttMetadata() {
  return {
    enabled: !!candidate,
    connected,
    candidate_id: candidate,
    ...(await repo.metadata(candidate)),
    connection_error: lastError,
  };
}
export function startMqtt() {
  if (!candidate) {
    console.log("MQTT disabled: CANDIDATE_ID is empty");
    return async () => {};
  }
  if (!/^[A-Za-z0-9_-]+$/.test(candidate))
    throw new Error(
      "CANDIDATE_ID must contain letters, numbers, underscores or hyphens",
    );
  const topics = {
    challenge: `fse-01/${candidate}/challenge`,
    response: `fse-01/${candidate}/response`,
    status: `fse-01/${candidate}/status`,
  };
  const status = (state: string) =>
    JSON.stringify({
      protocol_version: "1.0",
      candidate_id: candidate,
      status: state,
      timestamp: new Date().toISOString(),
    });
  client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://152.42.238.142:1883", {
    clientId: `fse01-${candidate}-${randomBytes(4).toString("hex")}`,
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10000,
    will: {
      topic: topics.status,
      payload: Buffer.from(status("OFFLINE")),
      qos: 1,
      retain: false,
    },
  });
  let stopped = false;
  let backoff = 1000;
  let reconnect: NodeJS.Timeout | undefined;
  let queue = Promise.resolve();
  const publish = (topic: string, payload: string) =>
    new Promise<void>((resolve, reject) => {
      if (!client?.connected) return reject(new Error("MQTT disconnected"));
      const timeout = setTimeout(
        () => reject(new Error("MQTT PUBACK timeout")),
        10000,
      );
      client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
        clearTimeout(timeout);
        error ? reject(error) : resolve();
      });
    });
  const sendResponse = async (id: string | null, payload: string) => {
    try {
      await publish(topics.response, payload);
      await repo.markPublished(candidate, id, payload);
    } catch (error) {
      lastError = (error as Error).message;
      await repo.markPublished(candidate, id, payload, lastError);
      throw error;
    }
  };
  const flush = async () => {
    for (const row of await repo.unpublished(candidate))
      await sendResponse(row.challenge_id, row.serialized_response);
  };
  const enqueue = (fn: () => Promise<void>) => {
    queue = queue.then(fn).catch((error) => {
      lastError = (error as Error).message;
      console.error("MQTT:", lastError);
    });
  };
  client.on("connect", () => {
    client!.subscribe(topics.challenge, { qos: 1 }, (error, granted) => {
      if (error || granted?.some((g) => g.qos === 128)) {
        lastError = error?.message ?? "Subscription rejected";
        client!.end(true);
        return;
      }
      connected = true;
      lastError = null;
      backoff = 1000;
      enqueue(async () => {
        await publish(topics.status, status("ONLINE"));
        await flush();
      });
    });
  });
  client.on("error", (error) => {
    lastError = error.message;
    console.error("MQTT connection:", error.message);
  });
  client.on("close", () => {
    connected = false;
    if (stopped || reconnect) return;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      if (!stopped) client!.reconnect();
    }, backoff);
    backoff = Math.min(30000, backoff * 2);
  });
  client.on("message", (topic, payload) => {
    if (topic !== topics.challenge) return;
    enqueue(async () => {
      let body: unknown;
      let response;
      try {
        body = JSON.parse(payload.toString());
      } catch {
        response = await recordChallengeFailure(
          payload.toString(),
          candidate,
          "VALIDATION_ERROR",
          "Malformed challenge JSON",
        );
      }
      if (!response) {
        try {
          response = await handleChallenge(body, candidate);
        } catch (error) {
          console.error(error);
          response = await recordChallengeFailure(
            body,
            candidate,
            "INTERNAL_ERROR",
            "Processing failed; event transaction rolled back",
          );
        }
      }
      await sendResponse(response.challenge_id, JSON.stringify(response));
    });
  });
  const heartbeat = setInterval(() => {
    if (connected) {
      // Keep status delivery independent of the processing queue for long batches.
      void publish(topics.status, status("HEARTBEAT")).catch((error) => {
        lastError = (error as Error).message;
      });
      enqueue(flush);
    }
  }, 25000);
  return async () => {
    stopped = true;
    clearInterval(heartbeat);
    if (reconnect) clearTimeout(reconnect);
    await queue;
    if (client?.connected)
      await publish(topics.status, status("OFFLINE")).catch(() => {});
    await new Promise<void>((resolve) =>
      client!.end(true, {}, () => resolve()),
    );
    connected = false;
  };
}
