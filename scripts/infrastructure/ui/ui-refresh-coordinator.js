export class UiRefreshCoordinator {
  #pending = new Map();
  #active = new Map();

  request(tasks = []) {
    const requested = new Set();
    for (const task of tasks) {
      if (!task || task.key == null || typeof task.run !== "function") {
        continue;
      }
      let promise = this.#pending.get(task.key);
      if (!promise) {
        // Batch same-turn requests, but only wait for this app's previous render.
        promise = (this.#active.get(task.key) ?? Promise.resolve())
          .catch(() => undefined)
          .then(() => {
            this.#pending.delete(task.key);
            return task.run();
          });
        this.#pending.set(task.key, promise);
        this.#active.set(task.key, promise);
        const finished = () => {
          if (this.#active.get(task.key) === promise) this.#active.delete(task.key);
        };
        promise.then(finished, finished);
      }
      requested.add(promise);
    }
    return Promise.allSettled([...requested]);
  }
}
