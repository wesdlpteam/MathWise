export function responseDeadline(req, res, timeoutMs = 180000, idleMs = 90000) {
  const controller = new AbortController();
  const timeout = () => controller.abort(Object.assign(new Error("Upstream response timed out"), { name: "AbortError" }));
  const timer = setTimeout(timeout, timeoutMs);
  let idle;
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  req.once?.("aborted", cancel);
  res.once?.("close", cancel);
  req.signal?.addEventListener("abort", cancel, { once: true });
  if (req.signal?.aborted) cancel();
  return {
    signal: controller.signal,
    async wait(promise) {
      clearTimeout(idle);
      idle = setTimeout(timeout, idleMs);
      try {
        return await new Promise((resolve, reject) => {
          const abort = () => reject(controller.signal.reason);
          Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
          if (controller.signal.aborted) { abort(); return; }
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      } finally { clearTimeout(idle); }
    },
    close() {
      clearTimeout(timer); clearTimeout(idle);
      req.off?.("aborted", cancel); res.off?.("close", cancel);
      req.signal?.removeEventListener("abort", cancel);
      controller.abort();
    },
  };
}
