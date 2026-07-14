/**
 * Single in-flight A2A task queue per agent container.
 */
export function createTaskQueue() {
  /** @type {Map<string, { id: string, status: string, message: string, result?: string, error?: string, createdAt: string, updatedAt: string }>} */
  const tasks = new Map();
  let busy = false;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();

  return {
    /**
     * @param {string} id
     * @param {string} message
     * @param {(msg: string) => Promise<string>} runner
     */
    enqueue(id, message, runner) {
      const now = new Date().toISOString();
      const task = {
        id,
        status: "submitted",
        message,
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(id, task);

      chain = chain.then(async () => {
        busy = true;
        task.status = "working";
        task.updatedAt = new Date().toISOString();
        try {
          const result = await runner(message);
          task.result = result;
          task.status = "completed";
        } catch (e) {
          task.error = e instanceof Error ? e.message : String(e);
          task.status = "failed";
        }
        task.updatedAt = new Date().toISOString();
        busy = false;
      });

      return task;
    },

    /** @param {string} id */
    get(id) {
      return tasks.get(id) ?? null;
    },

    list() {
      return [...tasks.values()];
    },

    isBusy() {
      return busy;
    },
  };
}
