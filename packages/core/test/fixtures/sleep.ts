/** A compute call that takes 50ms and answers nothing: what the call-budget tests time out, or don't. */
export default async function sleep() {
  await new Promise((r) => setTimeout(r, 50));
  return [];
}
