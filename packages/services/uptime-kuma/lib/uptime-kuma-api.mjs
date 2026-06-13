import { io } from "socket.io-client";

/**
 * @typedef {Record<string, unknown>} UptimeKumaMonitorRow
 */

/**
 * @param {string} baseUrl
 * @param {{ username: string; password: string; timeoutMs?: number }} auth
 */
export function createUptimeKumaClient(baseUrl, auth) {
  const timeoutMs = auth.timeoutMs ?? 15000;
  const url = baseUrl.replace(/\/$/, "");

  /** @type {import("socket.io-client").Socket | null} */
  let socket = null;

  /**
   * @param {string} event
   * @param {unknown} [payload]
   */
  function emitWithCallback(event, payload) {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error("Uptime Kuma socket not connected"));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`Uptime Kuma socket timeout waiting for ${event}`));
      }, timeoutMs);

      const callback = (resp) => {
        clearTimeout(timer);
        if (!resp || resp.ok === false) {
          reject(new Error(resp?.msg ?? `${event} failed`));
          return;
        }
        resolve(resp);
      };

      if (payload === undefined) {
        socket.emit(event, callback);
      } else {
        socket.emit(event, payload, callback);
      }
    });
  }

  return {
    async connect() {
      if (socket?.connected) return;
      socket = io(url, {
        transports: ["websocket", "polling"],
        reconnection: false,
        timeout: timeoutMs,
      });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Uptime Kuma socket connect timeout")), timeoutMs);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
        socket.once("connect_error", (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    },

    async login() {
      await this.connect();
      const resp = await new Promise((resolve, reject) => {
        if (!socket) {
          reject(new Error("Uptime Kuma socket not connected"));
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error("Uptime Kuma socket timeout waiting for login"));
        }, timeoutMs);
        socket.emit("login", { username: auth.username, password: auth.password }, (data) => {
          clearTimeout(timer);
          resolve(data ?? {});
        });
      });
      if (resp.tokenRequired) {
        throw new Error(
          "Uptime Kuma admin account requires 2FA; disable 2FA or use an account without 2FA for hdc automation",
        );
      }
      if (resp.ok === false) {
        throw new Error(typeof resp.msg === "string" ? resp.msg : "Uptime Kuma login failed");
      }
      return resp;
    },

    async disconnect() {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    },

    /**
     * @returns {Promise<UptimeKumaMonitorRow[]>}
     */
    async getMonitorList() {
      const resp = await emitWithCallback("getMonitorList");
      const list = resp.monitorList ?? resp;
      if (Array.isArray(list)) return list;
      if (list && typeof list === "object") {
        return Object.values(list);
      }
      return [];
    },

    /**
     * @param {Record<string, unknown>} monitor
     */
    async addMonitor(monitor) {
      const resp = await emitWithCallback("add", monitor);
      return { monitorID: resp.monitorID ?? resp.monitorId ?? null, ...resp };
    },

    /**
     * @param {Record<string, unknown>} monitor
     */
    async editMonitor(monitor) {
      return emitWithCallback("editMonitor", monitor);
    },

    /**
     * @param {number} monitorID
     */
    async deleteMonitor(monitorID) {
      return emitWithCallback("deleteMonitor", monitorID);
    },
  };
}
