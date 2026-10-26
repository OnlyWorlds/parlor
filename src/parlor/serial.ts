/**
 * One at a time, in the order asked. Two writes in flight land in whatever
 * order the server takes them: a host's Build then Showcase, clicked quickly,
 * ended on Build (a Firefox walk). A failed job does not stop the next.
 */
export function serialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
