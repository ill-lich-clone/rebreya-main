export class UiRefreshCoordinator {
  #pending = new Map();
  #drainPromise = null;

  request(tasks = []) {
    for (const task of tasks) {
      if (!task || task.key == null || typeof task.run !== "function") {
        continue;
      }
      if (!this.#pending.has(task.key)) {
        this.#pending.set(task.key, task.run);
      }
    }

    if (!this.#drainPromise && this.#pending.size > 0) {
      this.#drainPromise = this.#drain();
    }

    return this.#drainPromise ?? Promise.resolve([]);
  }

  async #drain() {
    try {
      // Let setting callbacks, socket messages and document hooks from the same mutation
      // join one batch before rendering any application.
      await Promise.resolve();

      const results = [];
      while (this.#pending.size > 0) {
        const batch = Array.from(this.#pending.values());
        this.#pending.clear();
        results.push(...await Promise.allSettled(
          batch.map((run) => Promise.resolve().then(run))
        ));
      }
      return results;
    }
    finally {
      this.#drainPromise = null;
    }
  }
}
