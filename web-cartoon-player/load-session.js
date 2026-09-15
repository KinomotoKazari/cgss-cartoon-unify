export function createLoadSession({workerUrl, createViewer, onProgress = () => {}, onLoaded = () => {}, onError = () => {}, onBusy = () => {}}) {
  // Own the worker and viewer together so every entry point cancels work consistently.
  let active = null;
  let viewer = null;

  function cancel() {
    // The active job identity lets late worker messages be ignored after cancellation.
    const job = active;
    active = null;
    job?.worker?.terminate();
    onBusy(false);
  }

  function load(source) {
    // Replace the previous worker before starting a new upload or remote request.
    cancel();
    const job = {worker: null};
    active = job;
    onBusy(true);

    const fail = error => {
      if (active !== job) return;
      cancel();
      onError(error);
    };

    try {
      const worker = new Worker(workerUrl, {type: 'module'});
      job.worker = worker;
      worker.onerror = event => fail(new Error(event.message));
      worker.onmessage = async ({data}) => {
        if (active !== job) return;
        if (data.type === 'progress') { onProgress(data.message); return; }
        if (data.type === 'error') { fail(new Error(data.message)); return; }
        if (data.type !== 'loaded') return;
        worker.terminate();
        job.worker = null;
        let next;
        try {
          viewer?.dispose();
          viewer = null;
          next = await createViewer(data.card);
          // Viewer creation is asynchronous, so it can finish after a later load begins.
          if (active !== job) { next.dispose(); return; }
          onLoaded(next, data.card);
          viewer = next;
          active = null;
          onBusy(false);
        } catch (error) {
          next?.dispose();
          fail(error);
        }
      };
      worker.postMessage(source);
    } catch (error) {
      fail(error);
    }
  }

  return {
    load,
    cancel,
    play() { viewer?.play(); },
    pause() { viewer?.pause(); },
    dispose() {
      cancel();
      viewer?.dispose();
      viewer = null;
    }
  };
}
