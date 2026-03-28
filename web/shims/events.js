// Minimal events shim for browser use.
// Only `once` is needed by the codebase.

export function once(emitter, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      emitter.removeListener('error', onError);
      resolve(args);
    };
    const onError = (err) => {
      emitter.removeListener(event, onEvent);
      reject(err);
    };
    emitter.once(event, onEvent);
    emitter.once('error', onError);
  });
}

export default { once };
